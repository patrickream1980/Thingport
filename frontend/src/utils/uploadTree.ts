import { UnauthorizedError } from "../api/client";
import { categoriesApi, type Category } from "../api/categories";
import { printsApi, type Print } from "../api/prints";
import { MODEL_EXTS, UPLOAD_EXTS } from "../constants/fileTypes";

export type UploadEntry = {
  file: File;
  relativePath: string;
};

type FileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => FileSystemDirectoryReader;
};

type FileSystemDirectoryReader = {
  readEntries: (success: (entries: FileSystemEntry[]) => void, error?: (err: unknown) => void) => void;
};

function normalizeRelativePath(path: string) {
  const trimmed = (path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return trimmed || "";
}

export function entriesFromFileList(files: FileList | File[]): UploadEntry[] {
  return Array.from(files || []).map((file) => {
    const anyFile = file as File & { webkitRelativePath?: string };
    const relativePath = normalizeRelativePath(anyFile.webkitRelativePath || file.name);
    return { file, relativePath: relativePath || file.name };
  });
}

async function readAllEntries(reader: FileSystemDirectoryReader) {
  const entries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

async function traverseEntry(entry: FileSystemEntry, parentPath: string, output: UploadEntry[]) {
  const entryPath = normalizeRelativePath(parentPath ? `${parentPath}/${entry.name}` : entry.name);
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
    output.push({ file, relativePath: entryPath || file.name });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const entries = await readAllEntries(reader);
    await Promise.all(entries.map((child) => traverseEntry(child, entryPath, output)));
  }
}

export async function entriesFromDataTransfer(dataTransfer: DataTransfer): Promise<UploadEntry[]> {
  const output: UploadEntry[] = [];
  const items = Array.from(dataTransfer.items || []);
  const entryItems = items
    .map((item) => (item as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
    .filter(Boolean) as FileSystemEntry[];

  if (entryItems.length) {
    await Promise.all(entryItems.map((entry) => traverseEntry(entry, "", output)));
    return output;
  }

  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    const anyFile = file as File & { webkitRelativePath?: string };
    const relativePath = normalizeRelativePath(anyFile.webkitRelativePath || file.name);
    output.push({ file, relativePath: relativePath || file.name });
  }

  if (!output.length) {
    return entriesFromFileList(dataTransfer.files || []);
  }
  return output;
}

/** Finds or creates the category path under `baseCategoryId`, one segment per level. */
function categoryResolver(baseCategoryId: string | null) {
  const cache = new Map<string, string>();
  // Folders reuse a same-named category in the same place, so uploading a tree twice doesn't duplicate it.
  let existing: Category[] | null = null;

  const child = async (parentId: string | null, key: string, name: string) => {
    const cached = cache.get(key);
    if (cached) return cached;
    existing ??= await categoriesApi.list();
    // At the top level only a folder is reused: uploaded folders shouldn't merge into a starter category.
    const match = existing.find(
      (c) => (c.parent_id ?? null) === parentId && c.name === name && (parentId || c.kind === "folder"),
    );
    const id = match ? match.id : ((await categoriesApi.create(name, [], parentId || undefined)) as { id: string }).id;
    cache.set(key, id);
    return id;
  };

  return async (segments: string[]) => {
    let categoryId = baseCategoryId;
    let key = baseCategoryId || "root";
    for (const segment of segments) {
      key = `${key}/${segment}`;
      categoryId = await child(categoryId, key, segment);
    }
    return categoryId;
  };
}

function splitPath(entry: UploadEntry) {
  const segments = normalizeRelativePath(entry.relativePath || entry.file.name)
    .split("/")
    .filter(Boolean);
  segments.pop();
  return segments;
}

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isModelFile(name: string) {
  return MODEL_EXTS.has(extOf(name));
}

/**
 * Builds one Thingport model without sending the whole folder in one multipart request.
 * This avoids nginx's total request-size ceiling for very large model folders.
 */
async function uploadFolderModelSequential(
  entries: UploadEntry[],
  title: string,
  categoryId: string | null,
): Promise<Print> {
  const sorted = entries.toSorted(byName);
  const modelEntries = sorted.filter((e) => isModelFile(e.file.name));
  const previewEntries = sorted.filter((e) => isPreviewImage(e.file));
  const supportingEntries = sorted.filter(
    (e) => !isModelFile(e.file.name) && !isPreviewImage(e.file),
  );

  if (!modelEntries.length) {
    throw new Error("Folder contains no supported model files");
  }

  const created = await printsApi.upload([modelEntries[0].file], {
    title,
    category_id: categoryId || undefined,
  });
  let print = created.prints[0];
  if (!print) throw new Error("Upload did not create a model");

  for (const entry of modelEntries.slice(1)) {
    print = (await printsApi.addPlates(print.id, [entry.file])).print;
  }

  for (const entry of previewEntries) {
    print = (await printsApi.addPreviewImages(print.id, [entry.file])).print;
  }

  for (const entry of supportingEntries) {
    print = await printsApi.uploadFile(print.id, entry.file);
  }

  return print;
}

// Larger images than the preview-image endpoint takes are attached to the model as files instead.
const PREVIEW_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "bmp"]);
const PREVIEW_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

// OS metadata a folder pick drags along, never meant as content.
const SYSTEM_FILES = new Set(["thumbs.db", "desktop.ini"]);

export function isSystemFile(name: string) {
  return name.startsWith(".") || SYSTEM_FILES.has(name.toLowerCase());
}

function isPreviewImage(file: File) {
  return PREVIEW_IMAGE_EXTS.has(extOf(file.name)) && file.size <= PREVIEW_IMAGE_MAX_BYTES;
}

/** True when some folder in the upload holds a model file, so the folder-as-model choice means something. */
export function hasModelFolders(entries: UploadEntry[]) {
  return entries.some((entry) => splitPath(entry).length > 0 && isModelFile(entry.file.name));
}

const byName = (a: UploadEntry, b: UploadEntry) =>
  a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: "base" });

function failureLabel(name: string, err: unknown) {
  const message = err instanceof Error ? err.message.trim() : "";
  return message && message !== "Upload failed" ? `${name} (${message})` : name;
}

export function uploadEntriesToCategory(
  entries: UploadEntry[],
  parentCategoryId: string | null,
  onUnauthorized?: () => void,
) {
  return uploadEach(entries, categoryResolver(parentCategoryId), onUnauthorized);
}

async function uploadEach(
  entries: UploadEntry[],
  resolveCategory: ReturnType<typeof categoryResolver>,
  onUnauthorized?: () => void,
) {
  const failed: string[] = [];
  let uploaded = 0;
  const uploadedEntries: UploadEntry[] = [];
  const prints: Print[] = [];

  // A folder pick isn't filtered by the file picker, so skip what couldn't become a model on its own.
  for (const entry of entries.filter((e) => UPLOAD_EXTS.includes(extOf(e.file.name)))) {
    try {
      const segments = splitPath(entry);
      let categoryId: string | null;
      try {
        categoryId = await resolveCategory(segments);
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        console.error("Category creation failed for", entry.relativePath, err);
        failed.push(entry.file.name);
        continue;
      }
      // Folder-tree leaves are always single-plate prints.
      const result = await printsApi.upload([entry.file], { category_id: categoryId || undefined });
      uploaded += 1;
      uploadedEntries.push(entry);
      prints.push(...result.prints);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        break;
      }
      console.error("Upload failed for", entry.file.name, err);
      failed.push(failureLabel(entry.file.name, err));
    }
  }
  return { uploaded, failed, uploadedEntries, prints };
}

/**
 * Each folder that directly holds model files becomes one model named after the folder: its model files
 * are the plates, its images the preview images, anything else is attached. The folders above it become
 * categories; files outside any model folder upload one model each, as usual.
 */
export async function uploadFoldersAsModels(
  entries: UploadEntry[],
  parentCategoryId: string | null,
  onUnauthorized?: () => void,
) {
  /*
   * Folder-tree import semantics:
   *
   *   SelectedRoot/
   *     Bases/
   *       base-a.stl
   *       variants/base-b.stl
   *     Bins/
   *       bin-a.stl
   *
   * becomes a Thingport folder/category "SelectedRoot" containing two models:
   * "Bases" and "Bins". Everything below each immediate child folder is folded into
   * that model recursively. Files directly in SelectedRoot still import individually.
   *
   * This is intentionally based on the first two relative-path segments rather than
   * the direct parent folder of every file, so deeper subfolders don't fragment one
   * logical model into many Thingport models.
   */
  const rootNames = [...new Set(
    entries
      .map((entry) => normalizeRelativePath(entry.relativePath || entry.file.name).split("/").filter(Boolean)[0])
      .filter(Boolean),
  )];

  const modelGroups = new Map<
    string,
    { rootName: string; modelName: string; entries: UploadEntry[] }
  >();
  const rootLevelEntries: UploadEntry[] = [];

  for (const entry of entries) {
    const parts = normalizeRelativePath(entry.relativePath || entry.file.name)
      .split("/")
      .filter(Boolean);

    // Folder picker paths normally start with the selected root folder name.
    if (parts.length >= 3) {
      const rootName = parts[0];
      const modelName = parts[1];
      const key = `${rootName}/${modelName}`;
      const group = modelGroups.get(key) ?? { rootName, modelName, entries: [] };
      group.entries.push(entry);
      modelGroups.set(key, group);
    } else {
      // A file directly inside the selected root remains its own model/file import.
      rootLevelEntries.push(entry);
    }
  }

  const failed: string[] = [];
  let uploaded = 0;
  const uploadedEntries: UploadEntry[] = [];
  const prints: Print[] = [];
  const resolveCategory = categoryResolver(parentCategoryId);

  for (const group of modelGroups.values()) {
    const sorted = group.entries.toSorted(byName);
    const images = sorted.filter((e) => isPreviewImage(e.file));
    const files = sorted.filter((e) => !isPreviewImage(e.file));

    // Only turn the child folder into a model when something beneath it is actually a model file.
    // Otherwise let those entries fall through to normal per-file handling below.
    if (!files.some((e) => isModelFile(e.file.name))) {
      rootLevelEntries.push(...group.entries);
      continue;
    }

    try {
      let categoryId: string | null;
      try {
        categoryId = await resolveCategory([group.rootName]);
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        console.error("Category creation failed for", group.rootName, err);
        failed.push(group.modelName);
        continue;
      }

      const print = await uploadFolderModelSequential(group.entries, group.modelName, categoryId);
      uploaded += 1;
      uploadedEntries.push(...group.entries);
      prints.push(print);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return { uploaded, failed, uploadedEntries, prints };
      }
      console.error("Upload failed for", group.modelName, err);
      failed.push(failureLabel(group.modelName, err));
    }
  }

  if (rootLevelEntries.length) {
    const result = await uploadEach(rootLevelEntries, resolveCategory, onUnauthorized);
    uploaded += result.uploaded;
    failed.push(...result.failed);
    uploadedEntries.push(...result.uploadedEntries);
    prints.push(...result.prints);
  }

  return { uploaded, failed, uploadedEntries, prints };
}
