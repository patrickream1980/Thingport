import { IMPORT_BROWSER_USER_AGENT, IMPORT_HTML_MAX_BYTES, IMPORT_TIMEOUT_SECONDS } from "../config";
import { HttpError } from "../utils/fileUtils";
import { type ImportedAuthorInfo, type ImportedPageMetadata } from "./importResolvers";
import { htmlToMarkdown } from "./descriptionMarkdown";

// Unlike Cloudflare-gated www.printables.com, the GraphQL API answers unauthenticated requests.
const PRINTABLES_GRAPHQL_URL = "https://api.printables.com/graphql/";
const PRINTABLES_MEDIA_BASE = "https://media.printables.com/";
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PRINTABLES_PROVIDER = "printables";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mediaUrl(filePath: unknown): string | null {
  return typeof filePath === "string" && filePath.trim() ? `${PRINTABLES_MEDIA_BASE}${filePath.trim()}` : null;
}

export function parsePrintablesModelUrl(url: string): { modelId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "printables.com" && host !== "www.printables.com") return null;
  const m = parsed.pathname.match(/\/model\/(\d+)/i);
  return m ? { modelId: m[1] } : null;
}

async function fetchPrintablesGraphql(query: string, variables: Record<string, unknown>): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(PRINTABLES_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "User-Agent": IMPORT_BROWSER_USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://www.printables.com",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  if (res.status === 429) throw new HttpError(429, "Printables rate-limited this request. Wait a bit and try again.");
  if (!res.ok) return null;
  if (text.length > IMPORT_HTML_MAX_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parsePrintablesErrorMessages(errors: unknown): string | null {
  if (!Array.isArray(errors)) return null;
  const messages: string[] = [];
  for (const err of errors) {
    if (!err || typeof err !== "object") continue;
    const values = (err as Record<string, unknown>).messages;
    if (Array.isArray(values)) {
      for (const v of values) if (typeof v === "string" && v.trim()) messages.push(v.trim());
    }
  }
  return messages.length ? messages.join(", ") : null;
}

const MODEL_QUERY = `
  query ($id: ID!) {
    print(id: $id) {
      id
      name
      description
      user { id handle publicUsername avatarFilePath }
      image { filePath }
      images { filePath }
      tags { name }
      category { id name }
      stls { id name }
    }
  }
`;

const DOWNLOAD_LINK_MUTATION = `
  mutation ($printId: ID!, $source: DownloadSourceEnum!, $files: [DownloadFileInput!]) {
    getDownloadLink(printId: $printId, source: $source, files: $files) {
      ok
      errors { field messages code }
      output { files { id link } }
    }
  }
`;

function extractAuthor(user: Record<string, unknown>): ImportedAuthorInfo | null {
  const externalId = user.id != null ? String(user.id) : null;
  if (!externalId) return null;
  const handle = typeof user.handle === "string" && user.handle.trim() ? user.handle.trim() : null;
  const name =
    (typeof user.publicUsername === "string" && user.publicUsername.trim() && user.publicUsername.trim()) || handle;
  return {
    provider: PRINTABLES_PROVIDER,
    externalId,
    name,
    handle,
    bio: null,
    bioTranslated: null,
    links: handle ? [`https://www.printables.com/@${handle}`] : [],
    avatarUrl: mediaUrl(user.avatarFilePath),
    backgroundUrl: null,
  };
}

export type PrintablesPlateFile = { name: string; id: string };
export type PrintablesGalleryImage = { name: string; url: string };

export type PrintablesModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  /** From the `stls` bucket, which holds every model-file type despite its name. Pre-sliced
   * gcodes/slas are excluded. Download links are resolved separately. */
  plateFiles: PrintablesPlateFile[];
  /** Includes the cover image. */
  galleryImages: PrintablesGalleryImage[];
};

/** Null for a model that doesn't exist or isn't public. */
export async function resolvePrintablesModel(modelId: string): Promise<PrintablesModelResolution | null> {
  const data = (await fetchPrintablesGraphql(MODEL_QUERY, { id: modelId })) as {
    data?: { print?: Record<string, unknown> };
  } | null;
  const model = data?.data?.print;
  if (!isRecord(model)) return null;

  const meta: Partial<ImportedPageMetadata> = {};
  if (typeof model.name === "string" && model.name.trim()) meta.title = model.name.trim();
  if (typeof model.description === "string" && model.description.trim()) {
    const markdown = htmlToMarkdown(model.description);
    if (markdown) meta.description = markdown;
  }
  if (Array.isArray(model.tags)) {
    const tags = model.tags
      .map((t) => (isRecord(t) && typeof t.name === "string" ? t.name.trim() : null))
      .filter((t): t is string => Boolean(t));
    if (tags.length) meta.tags = tags;
  }

  const cover = isRecord(model.image) ? mediaUrl(model.image.filePath) : null;
  if (cover) meta.previewImageUrl = cover;
  const galleryImages: PrintablesGalleryImage[] = Array.isArray(model.images)
    ? model.images
        .map((img, idx) => (isRecord(img) ? { name: `image-${idx}.jpg`, url: mediaUrl(img.filePath) } : null))
        .filter((img): img is PrintablesGalleryImage & { url: string } => Boolean(img?.url))
    : [];

  if (isRecord(model.user)) {
    const author = extractAuthor(model.user);
    if (author) {
      meta.author = author;
      meta.creator = author.name;
    }
  }

  if (isRecord(model.category) && model.category.id != null) {
    const categoryId = Number(model.category.id);
    if (Number.isFinite(categoryId)) {
      meta.siteCategoryIds = [categoryId];
      meta.categorySite = PRINTABLES_PROVIDER;
    }
  }

  const plateFiles: PrintablesPlateFile[] = Array.isArray(model.stls)
    ? model.stls
        .filter((f): f is Record<string, unknown> => isRecord(f) && typeof f.name === "string" && f.id != null)
        .map((f) => ({ name: f.name as string, id: String(f.id) }))
    : [];

  return { meta, plateFiles, galleryImages };
}

/** Printables has no static file URLs; every download goes through this mutation. A file missing
 * from the response is skipped. */
export async function resolvePrintablesDownloadLinks(modelId: string, fileIds: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (!fileIds.length) return links;

  const data = (await fetchPrintablesGraphql(DOWNLOAD_LINK_MUTATION, {
    printId: modelId,
    source: "model_detail",
    files: [{ fileType: "stl", ids: fileIds }],
  })) as { data?: { getDownloadLink?: Record<string, unknown> } } | null;

  const result = data?.data?.getDownloadLink;
  if (!isRecord(result)) return links;
  if (result.ok === false) {
    const message = parsePrintablesErrorMessages(result.errors);
    throw new HttpError(400, message || "Printables rejected the download request");
  }
  const output = result.output;
  const files = isRecord(output) ? output.files : null;
  if (Array.isArray(files)) {
    for (const entry of files) {
      if (isRecord(entry) && entry.id != null && typeof entry.link === "string" && entry.link.trim()) {
        links.set(String(entry.id), entry.link.trim());
      }
    }
  }
  return links;
}

/** The `@handle` segment is cosmetic; only the id is used. */
export function parsePrintablesCollectionUrl(url: string): { collectionId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "printables.com" && host !== "www.printables.com") return null;
  const m = parsed.pathname.match(/\/collections\/(\d+)/i);
  return m ? { collectionId: m[1] } : null;
}

export type PrintablesCollectionEntry = { modelId: string; title: string; cover: string | null };

/** Thumbnail listings have no name, only a slug. */
function titleFromSlug(slug: string): string {
  const words = slug.split("-").filter(Boolean);
  if (!words.length) return slug;
  return (
    words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? " " + words.slice(1).join(" ") : "")
  );
}

const COLLECTION_TITLE_QUERY = `query ($id: ID!) { collection(id: $id) { id name } }`;

export async function fetchPrintablesCollectionTitle(collectionId: string): Promise<string | null> {
  const data = (await fetchPrintablesGraphql(COLLECTION_TITLE_QUERY, { id: collectionId })) as {
    data?: { collection?: Record<string, unknown> };
  } | null;
  const name = data?.data?.collection?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

// The site's own "load more" query. The last page ends with an empty-string cursor, not null --
// a `cursor == null` check restarts from page 1 forever.
const COLLECTION_MODELS_QUERY = `
  query CollectionModels($collectionId: ID!, $limit: Int, $cursor: String, $ordering: CollectionPrintsOrderingEnum) {
    moreCollectionModels(limit: $limit, cursor: $cursor, collectionId: $collectionId, ordering: $ordering) {
      items {
        id
        model: print { id name slug image { filePath } }
      }
      cursor
    }
  }
`;

const COLLECTION_PAGE_SIZE = 30;
const COLLECTION_MAX_PAGES = 20;
const COLLECTION_MAX_ENTRIES = 600;

/** The caps are a safety net against a non-terminating cursor. Items for deleted/hidden models
 * are skipped. */
async function fetchAllPrintablesCollectionModels(collectionId: string): Promise<PrintablesCollectionEntry[]> {
  const found = new Map<string, PrintablesCollectionEntry>();
  let cursor: string | null = null;
  for (let page = 0; page < COLLECTION_MAX_PAGES && found.size < COLLECTION_MAX_ENTRIES; page++) {
    const data = (await fetchPrintablesGraphql(COLLECTION_MODELS_QUERY, {
      collectionId,
      limit: COLLECTION_PAGE_SIZE,
      cursor,
      ordering: "added_to_collection",
    })) as { data?: { moreCollectionModels?: { items?: unknown[]; cursor?: string | null } } } | null;
    const node = data?.data?.moreCollectionModels;
    const items = Array.isArray(node?.items) ? node.items : [];
    if (!items.length) break;

    for (const item of items) {
      if (found.size >= COLLECTION_MAX_ENTRIES) break;
      if (!isRecord(item) || !isRecord(item.model)) continue;
      const model = item.model;
      if (model.id == null || typeof model.slug !== "string" || !model.slug.trim()) continue;
      const modelId = String(model.id);
      if (found.has(modelId)) continue;
      const cover = isRecord(model.image) ? mediaUrl(model.image.filePath) : null;
      found.set(modelId, { modelId, title: titleFromSlug(model.slug.trim()), cover });
    }

    const nextCursor = node?.cursor;
    if (!nextCursor) break; // empty string or null/undefined both mean "no more pages"
    cursor = nextCursor;
  }
  return Array.from(found.values());
}

/** `truncated` only when the safety caps were hit. */
export async function fetchPrintablesCollectionEntries(
  collectionId: string,
): Promise<{ title: string | null; entries: PrintablesCollectionEntry[]; total: number; truncated: boolean }> {
  const [title, entries] = await Promise.all([
    fetchPrintablesCollectionTitle(collectionId),
    fetchAllPrintablesCollectionModels(collectionId),
  ]);
  return { title, entries, total: entries.length, truncated: entries.length >= COLLECTION_MAX_ENTRIES };
}
