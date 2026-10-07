import fs from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency, sleep } from "../utils/concurrency";
import { IMPORT_COLLECTION_DELAY_MS, IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../config";
import { countJobItems, getJob, getJobStatus, listJobItems, updateJob, updateJobItem } from "./importJobService";
import { createNotification } from "./notificationService";
import { addPrintsToCollection, findOrCreateCollectionByName } from "./collectionService";
import { resolveMakerworldCookie } from "./importResolvers";
import { decodeHtmlEntities } from "../utils/htmlEntities";
import {
  extractMakerworldBearerToken,
  parseMakerworldModelUrl,
  selectMakerworldProfiles,
  type MakerworldProfileScope,
  MAKERWORLD_DOWNLOAD_LIMIT_CODE,
  MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE,
} from "./makerworldCloudApi";
import { fetchMakerworldCollectionTitle, parseMakerworldCollectionUrl } from "./makerworldCollections";
import {
  downloadImportToTemp,
  fetchMakerworldDesignForImport,
  importPrintFromUrl,
  type ImportRequestBody,
} from "./importService";
import { upsertAuthorFromImport } from "./authorService";
import { extractZipEntriesToPrints } from "./zipService";
import { fetchThingiverseCollectionTitle } from "./thingiverseApi";
import { getThingiverseAccessToken } from "./settingsService";
import { fetchPrintablesCollectionTitle } from "./printablesApi";
import { createLog } from "./auditLog";
import { HttpError } from "../utils/fileUtils";
import { prisma } from "../db";

// Sequential on purpose: parallel bursts of api.bambulab.com calls trip MakerWorld's CAPTCHA.
const COLLECTION_IMPORT_CONCURRENCY = 1;

type CollectionImportJobBody = ImportRequestBody & { design_ids: string[] };
type ZipImportJobBody = ImportRequestBody & { entries: string[] };
type ThingiverseLikesImportJobBody = ImportRequestBody & { thing_ids: string[]; username: string };
type ThingiverseCollectionImportJobBody = ImportRequestBody & { thing_ids: string[]; collectionId: string };
type PrintablesCollectionImportJobBody = ImportRequestBody & { model_ids: string[]; collectionId: string };
type MakerworldProfilesImportJobBody = ImportRequestBody & { scope: Exclude<MakerworldProfileScope, "url"> };

// Why a design failed, so a batch reads as one clear cause instead of "N failed". Once a CAPTCHA
// ("rateLimited"), the daily download limit or an auth failure hits, every remaining item fails
// the same way.
type ImportFailureReason = "unavailable" | "rateLimited" | "downloadLimit" | "auth" | "other";
type StopReason = "rateLimited" | "downloadLimit" | "auth";

function classifyImportFailure(err: unknown): ImportFailureReason {
  if (err instanceof HttpError) {
    if (err.status === 403 || err.status === 404) return "unavailable";
    if (err.status === 429) return err.code === MAKERWORLD_DOWNLOAD_LIMIT_CODE ? "downloadLimit" : "rateLimited";
    if (err.status === 401) return "auth";
  }
  return "other";
}

function asStopReason(reason: ImportFailureReason): StopReason | null {
  return reason === "rateLimited" || reason === "downloadLimit" || reason === "auth" ? reason : null;
}

async function markJobFailed(jobId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : "Import failed";
  console.error(`Import job ${jobId} failed:`, err);
  await updateJob(jobId, { status: "ERROR", errorMessage: message }).catch(() => undefined);
}

type ProfileImportTotals = {
  processed: number;
  imported: number;
  alreadyInLibrary: number;
  failed: number;
  printId: string | null;
  stopReason: StopReason | null;
};

/** Imports each profile URL onto one print, in order. Once a CAPTCHA, download-limit or auth
 * failure hits, every remaining profile fails the same way without another MakerWorld call. */
async function importProfileUrlsSequentially(
  userId: string,
  profileUrls: string[],
  body: ImportRequestBody,
  onProgress?: (totals: ProfileImportTotals) => void,
): Promise<ProfileImportTotals> {
  const totals: ProfileImportTotals = {
    processed: 0,
    imported: 0,
    alreadyInLibrary: 0,
    failed: 0,
    printId: null,
    stopReason: null,
  };
  for (const profileUrl of profileUrls) {
    if (totals.stopReason) {
      totals.failed++;
    } else {
      try {
        const result = await importPrintFromUrl(userId, profileUrl, {
          ...body,
          url: profileUrl,
          makerworldPaceMs: IMPORT_MAKERWORLD_CALL_DELAY_MS,
        });
        totals.printId = result.print.id;
        if (result.alreadyImported) totals.alreadyInLibrary++;
        else totals.imported++;
      } catch (err) {
        totals.failed++;
        totals.stopReason = asStopReason(classifyImportFailure(err));
      }
    }
    totals.processed++;
    onProgress?.(totals);
  }
  return totals;
}

/** Imports several print profiles of one MakerWorld model as one model with a file per profile. */
export async function runMakerworldProfilesImportJob(
  jobId: string,
  userId: string,
  body: MakerworldProfilesImportJobBody,
): Promise<void> {
  try {
    const parsed = parseMakerworldModelUrl(body.url);
    if (!parsed) throw new HttpError(400, "Not a MakerWorld model link");
    const design = await fetchMakerworldDesignForImport(
      parsed.designId,
      resolveMakerworldCookie(body),
      IMPORT_MAKERWORLD_CALL_DELAY_MS,
    );
    if (!design) throw new HttpError(400, "Couldn't read this model's print profiles from MakerWorld");
    const profileIds = selectMakerworldProfiles(design, body.scope, parsed.requestedInstanceId);
    if (!profileIds.length) throw new HttpError(400, "This model has no print profiles to import");
    const title =
      typeof design.title === "string" && design.title.trim() ? decodeHtmlEntities(design.title.trim()) : null;
    await updateJob(jobId, { total: profileIds.length, sourceLabel: title });

    const totals = await importProfileUrlsSequentially(
      userId,
      profileIds.map((profileId) => `https://makerworld.com/en/models/${parsed.designId}#profileId-${profileId}`),
      body,
      (t) =>
        void updateJob(jobId, {
          processed: t.processed,
          imported: t.imported,
          alreadyInLibrary: t.alreadyInLibrary,
          failedCount: t.failed,
        }).catch(() => undefined),
    );
    const { imported, alreadyInLibrary, failed, stopReason } = totals;
    const printId = totals.printId;

    await updateJob(jobId, {
      status: "DONE",
      resultPrintId: printId,
      processed: totals.processed,
      imported,
      alreadyInLibrary,
      failedCount: failed,
    });
    void createLog({
      userId,
      action: "import_completed",
      targetId: printId,
      details: { provider: "makerworld", sourceLabel: title, imported, alreadyInLibrary, failed },
    });

    const bodyParts: string[] = [];
    if (alreadyInLibrary) bodyParts.push(`${alreadyInLibrary} already on the model`);
    if (stopReason === "rateLimited") {
      bodyParts.push(
        `the rest blocked by a MakerWorld CAPTCHA challenge — this usually clears in 1-4 hours, then import the model again to add the missing profiles`,
      );
    } else if (stopReason === "downloadLimit") {
      bodyParts.push(
        `the rest not downloaded — MakerWorld's daily download limit was reached, import the model again tomorrow to add the missing profiles`,
      );
    } else if (stopReason === "auth") {
      bodyParts.push(
        `the rest failed because your MakerWorld session expired — update the cookie in Settings and import again`,
      );
    } else if (failed) {
      bodyParts.push(`${failed} failed`);
    }
    const label = title ? `"${title}"` : "a MakerWorld model";
    await createNotification(userId, {
      title: `Imported ${imported} of ${profileIds.length} print profiles from MakerWorld`,
      body: bodyParts.length ? `Of ${label} — ${bodyParts.join(", ")}.` : `Of ${label}.`,
      externalUrl: body.url,
      internalPath: printId ? `/models/${printId}` : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

export async function runCollectionImportJob(
  jobId: string,
  userId: string,
  body: CollectionImportJobBody,
): Promise<void> {
  try {
    let imported = 0;
    let alreadyInLibrary = 0;
    let processed = 0;
    let unavailable = 0;
    let rateLimited = 0;
    let downloadLimited = 0;
    let authFailed = 0;
    const failed: string[] = [];
    const successPrintIds: string[] = [];

    await mapWithConcurrency(body.design_ids, COLLECTION_IMPORT_CONCURRENCY, async (designId) => {
      const modelUrl = `https://makerworld.com/en/models/${designId}`;
      const itemBody: ImportRequestBody = {
        url: modelUrl,
        notes: body.notes ?? null,
        tags: body.tags ?? [],
        category_id: body.category_id ?? null,
        makerworld_cookie: body.makerworld_cookie,
        makerworldPaceMs: IMPORT_MAKERWORLD_CALL_DELAY_MS,
      };
      try {
        // Every later download would hit the same limit, so don't spend more requests on it.
        if (downloadLimited) {
          throw new HttpError(429, MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE, MAKERWORLD_DOWNLOAD_LIMIT_CODE);
        }
        const { print, alreadyImported } = await importPrintFromUrl(userId, modelUrl, itemBody);
        successPrintIds.push(print.id);
        if (alreadyImported) alreadyInLibrary++;
        else imported++;
      } catch (err) {
        failed.push(designId);
        const reason = classifyImportFailure(err);
        if (reason === "unavailable") unavailable++;
        else if (reason === "rateLimited") rateLimited++;
        else if (reason === "downloadLimit") downloadLimited++;
        else if (reason === "auth") authFailed++;
      } finally {
        processed++;
        // A progress-write failure mustn't fail the whole batch.
        await updateJob(jobId, { processed, imported, alreadyInLibrary, failedCount: failed.length }).catch(
          () => undefined,
        );
      }
    });

    let resultCollectionId: string | null = null;
    let collectionTitle: string | null = null;
    if (successPrintIds.length) {
      const url = body.url;
      const parsed = parseMakerworldCollectionUrl(url);
      if (parsed) {
        const bearerToken = extractMakerworldBearerToken(resolveMakerworldCookie(body));
        collectionTitle = await fetchMakerworldCollectionTitle(
          parsed.collectionId,
          bearerToken,
          IMPORT_MAKERWORLD_CALL_DELAY_MS,
        );
        if (collectionTitle) {
          const collection = await findOrCreateCollectionByName(userId, collectionTitle);
          await addPrintsToCollection(collection.id, successPrintIds);
          resultCollectionId = collection.id;
        }
      }
    }

    await updateJob(jobId, {
      status: "DONE",
      sourceLabel: collectionTitle,
      resultCollectionId,
      resultPrintId: successPrintIds.length === 1 ? successPrintIds[0] : null,
      processed,
      imported,
      alreadyInLibrary,
      failedCount: failed.length,
    });
    void createLog({
      userId,
      action: "import_completed",
      targetId: resultCollectionId,
      details: {
        provider: "makerworld",
        sourceLabel: collectionTitle,
        imported,
        alreadyInLibrary,
        failed: failed.length,
      },
    });

    const label = collectionTitle ? `"${collectionTitle}"` : "a MakerWorld collection";
    const bodyParts: string[] = [];
    if (alreadyInLibrary) bodyParts.push(`${alreadyInLibrary} already in your library`);
    const otherFailed = failed.length - unavailable - rateLimited - downloadLimited - authFailed;
    if (unavailable) bodyParts.push(`${unavailable} unavailable (private, deleted, or hidden)`);
    if (rateLimited) {
      bodyParts.push(
        `${rateLimited} blocked by a MakerWorld CAPTCHA challenge (too many requests at once) — this usually clears in 1-4 hours, then retry the same collection`,
      );
    }
    if (downloadLimited) {
      bodyParts.push(
        `${downloadLimited} not downloaded — MakerWorld's daily download limit was reached, retry the same collection tomorrow`,
      );
    }
    if (authFailed)
      bodyParts.push(
        `${authFailed} failed because your MakerWorld session expired — update the cookie in Settings and retry`,
      );
    if (otherFailed) bodyParts.push(`${otherFailed} failed`);
    await createNotification(userId, {
      title: `Imported ${imported} of ${body.design_ids.length} models from MakerWorld`,
      body: bodyParts.length ? `From ${label} — ${bodyParts.join(", ")}.` : `From ${label}.`,
      externalUrl: body.url,
      internalPath: resultCollectionId ? `/models/collections/${resultCollectionId}` : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

/** Shared by the Thingiverse Likes and Collection imports. Successful imports are filed into the
 * collection named by `resolveCollectionTitle`, which runs afterwards so it costs no API call
 * when nothing was imported. */
async function runThingiverseThingsImportJob(
  jobId: string,
  userId: string,
  body: ImportRequestBody & { thing_ids: string[] },
  resolveCollectionTitle: (accessToken: string) => Promise<string>,
  sourceLabel: (collectionTitle: string) => string,
): Promise<void> {
  try {
    const accessToken = await getThingiverseAccessToken();
    if (!accessToken) {
      throw new HttpError(
        503,
        "Thingiverse import isn't configured for this instance yet -- ask an admin to add an Access Token in Admin Settings.",
      );
    }

    let imported = 0;
    let alreadyInLibrary = 0;
    let processed = 0;
    let unavailable = 0;
    let rateLimited = 0;
    let authFailed = 0;
    const failed: string[] = [];
    const successPrintIds: string[] = [];

    await mapWithConcurrency(body.thing_ids, COLLECTION_IMPORT_CONCURRENCY, async (thingId, index) => {
      const thingUrl = `https://www.thingiverse.com/thing:${thingId}`;
      const itemBody: ImportRequestBody = {
        url: thingUrl,
        notes: body.notes ?? null,
        tags: body.tags ?? [],
        category_id: body.category_id ?? null,
      };
      try {
        const { print, alreadyImported } = await importPrintFromUrl(userId, thingUrl, itemBody);
        successPrintIds.push(print.id);
        if (alreadyImported) alreadyInLibrary++;
        else imported++;
      } catch (err) {
        failed.push(thingId);
        const reason = classifyImportFailure(err);
        if (reason === "unavailable") unavailable++;
        else if (reason === "rateLimited") rateLimited++;
        else if (reason === "auth") authFailed++;
      } finally {
        processed++;
        await updateJob(jobId, { processed, imported, alreadyInLibrary, failedCount: failed.length }).catch(
          () => undefined,
        );
      }
      if (index < body.thing_ids.length - 1) await sleep(IMPORT_COLLECTION_DELAY_MS);
    });

    let resultCollectionId: string | null = null;
    const collectionTitle = await resolveCollectionTitle(accessToken);
    if (successPrintIds.length) {
      const collection = await findOrCreateCollectionByName(userId, collectionTitle);
      await addPrintsToCollection(collection.id, successPrintIds);
      resultCollectionId = collection.id;
    }

    await updateJob(jobId, {
      status: "DONE",
      sourceLabel: collectionTitle,
      resultCollectionId,
      resultPrintId: successPrintIds.length === 1 ? successPrintIds[0] : null,
      processed,
      imported,
      alreadyInLibrary,
      failedCount: failed.length,
    });
    void createLog({
      userId,
      action: "import_completed",
      targetId: resultCollectionId,
      details: {
        provider: "thingiverse",
        sourceLabel: collectionTitle,
        imported,
        alreadyInLibrary,
        failed: failed.length,
      },
    });

    const bodyParts: string[] = [];
    if (alreadyInLibrary) bodyParts.push(`${alreadyInLibrary} already in your library`);
    const otherFailed = failed.length - unavailable - rateLimited - authFailed;
    if (unavailable) bodyParts.push(`${unavailable} unavailable (private, deleted, or hidden)`);
    if (rateLimited) {
      bodyParts.push(
        `${rateLimited} blocked by Thingiverse's rate-limit protection (too many requests at once) — wait a while, then retry`,
      );
    }
    if (authFailed) bodyParts.push(`${authFailed} failed because the configured Access Token was rejected`);
    if (otherFailed) bodyParts.push(`${otherFailed} failed`);
    const label = sourceLabel(collectionTitle);
    await createNotification(userId, {
      title: `Imported ${imported} of ${body.thing_ids.length} models from Thingiverse`,
      body: bodyParts.length ? `From ${label} — ${bodyParts.join(", ")}.` : `From ${label}.`,
      externalUrl: body.url,
      internalPath: resultCollectionId ? `/models/collections/${resultCollectionId}` : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

export async function runThingiverseLikesImportJob(
  jobId: string,
  userId: string,
  body: ThingiverseLikesImportJobBody,
): Promise<void> {
  await runThingiverseThingsImportJob(
    jobId,
    userId,
    body,
    async () => "Thingiverse Likes",
    () => `@${body.username}'s Likes`,
  );
}

export async function runThingiverseCollectionImportJob(
  jobId: string,
  userId: string,
  body: ThingiverseCollectionImportJobBody,
): Promise<void> {
  await runThingiverseThingsImportJob(
    jobId,
    userId,
    body,
    async (accessToken) =>
      (await fetchThingiverseCollectionTitle(body.collectionId, accessToken)) ??
      `Thingiverse Collection ${body.collectionId}`,
    (collectionTitle) => `"${collectionTitle}"`,
  );
}

export async function runPrintablesCollectionImportJob(
  jobId: string,
  userId: string,
  body: PrintablesCollectionImportJobBody,
): Promise<void> {
  try {
    let imported = 0;
    let alreadyInLibrary = 0;
    let processed = 0;
    let unavailable = 0;
    let rateLimited = 0;
    const failed: string[] = [];
    const successPrintIds: string[] = [];

    await mapWithConcurrency(body.model_ids, COLLECTION_IMPORT_CONCURRENCY, async (modelId, index) => {
      const modelUrl = `https://www.printables.com/model/${modelId}`;
      const itemBody: ImportRequestBody = {
        url: modelUrl,
        notes: body.notes ?? null,
        tags: body.tags ?? [],
        category_id: body.category_id ?? null,
      };
      try {
        const { print, alreadyImported } = await importPrintFromUrl(userId, modelUrl, itemBody);
        successPrintIds.push(print.id);
        if (alreadyImported) alreadyInLibrary++;
        else imported++;
      } catch (err) {
        failed.push(modelId);
        const reason = classifyImportFailure(err);
        if (reason === "unavailable") unavailable++;
        else if (reason === "rateLimited") rateLimited++;
      } finally {
        processed++;
        await updateJob(jobId, { processed, imported, alreadyInLibrary, failedCount: failed.length }).catch(
          () => undefined,
        );
      }
      if (index < body.model_ids.length - 1) await sleep(IMPORT_COLLECTION_DELAY_MS);
    });

    let resultCollectionId: string | null = null;
    const collectionTitle =
      (await fetchPrintablesCollectionTitle(body.collectionId)) ?? `Printables Collection ${body.collectionId}`;
    if (successPrintIds.length) {
      const collection = await findOrCreateCollectionByName(userId, collectionTitle);
      await addPrintsToCollection(collection.id, successPrintIds);
      resultCollectionId = collection.id;
    }

    await updateJob(jobId, {
      status: "DONE",
      sourceLabel: collectionTitle,
      resultCollectionId,
      resultPrintId: successPrintIds.length === 1 ? successPrintIds[0] : null,
      processed,
      imported,
      alreadyInLibrary,
      failedCount: failed.length,
    });
    void createLog({
      userId,
      action: "import_completed",
      targetId: resultCollectionId,
      details: {
        provider: "printables",
        sourceLabel: collectionTitle,
        imported,
        alreadyInLibrary,
        failed: failed.length,
      },
    });

    const bodyParts: string[] = [];
    if (alreadyInLibrary) bodyParts.push(`${alreadyInLibrary} already in your library`);
    const otherFailed = failed.length - unavailable - rateLimited;
    if (unavailable) bodyParts.push(`${unavailable} unavailable (private, deleted, or removed)`);
    if (rateLimited) bodyParts.push(`${rateLimited} rate-limited by Printables — wait a while, then retry`);
    if (otherFailed) bodyParts.push(`${otherFailed} failed`);
    await createNotification(userId, {
      title: `Imported ${imported} of ${body.model_ids.length} models from Printables`,
      body: bodyParts.length ? `From "${collectionTitle}" — ${bodyParts.join(", ")}.` : `From "${collectionTitle}".`,
      externalUrl: body.url,
      internalPath: resultCollectionId ? `/models/collections/${resultCollectionId}` : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

export async function runZipImportJob(jobId: string, userId: string, body: ZipImportJobBody): Promise<void> {
  let tempPath: string | null = null;
  try {
    const downloaded = await downloadImportToTemp(body.url, body);
    tempPath = downloaded.tempPath;
    const { filename, meta } = downloaded;
    if (path.extname(filename).toLowerCase() !== ".zip") throw new HttpError(415, "Imported file is not a zip");

    await updateJob(jobId, { sourceLabel: filename, total: body.entries.length });

    const author = await upsertAuthorFromImport(meta.author);
    const { prints, failed } = await extractZipEntriesToPrints(
      userId,
      tempPath,
      body.entries,
      {
        title: body.title ?? meta.title,
        notes: body.notes ?? meta.description,
        tags: body.tags && body.tags.length ? body.tags : meta.tags,
        categoryId: body.category_id,
        creator: meta.creator,
        authorId: author?.id ?? null,
        previewImageUrl: meta.previewImageUrl,
        galleryImages: meta.galleryImages,
      },
      (processed, total, imported, failedSoFar) => {
        void updateJob(jobId, { processed, total, imported, failedCount: failedSoFar });
      },
    );

    await updateJob(jobId, {
      status: "DONE",
      processed: body.entries.length,
      imported: prints.length,
      failedCount: failed.length,
      resultPrintId: prints.length === 1 ? prints[0].id : null,
    });
    void createLog({
      userId,
      action: "import_completed",
      details: { provider: "zip", sourceLabel: filename, imported: prints.length, failed: failed.length },
    });

    const bodyParts: string[] = [];
    if (failed.length) bodyParts.push(`${failed.length} failed`);
    await createNotification(userId, {
      title: `Imported ${prints.length} of ${body.entries.length} models from ${filename}`,
      body: bodyParts.length ? `${bodyParts.join(", ")}.` : null,
      externalUrl: body.url,
      internalPath: null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  } finally {
    if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export type LinksImportJobBody = ImportRequestBody & { scope?: MakerworldProfileScope };

/** What a link sent from the extension's "Add to the queue" carries on its own item, over the job's
 *  shared body: the panel's collection and profile scope, and the page title for the queue page. */
export type QueuedLinkOptions = {
  collection_id?: string | null;
  scope?: MakerworldProfileScope;
  title?: string | null;
};

export function parseQueuedLinkOptions(payload: unknown): QueuedLinkOptions {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const p = payload as Record<string, unknown>;
  return {
    collection_id: typeof p.collection_id === "string" && p.collection_id ? p.collection_id : null,
    scope: p.scope === "designer" || p.scope === "all" || p.scope === "url" ? p.scope : undefined,
    title: typeof p.title === "string" && p.title ? p.title : null,
  };
}

// Runners alive in this process, by job. A PAUSED job's runner may still be finishing its current
// link, and a DONE one its notification; starting the job again before then would run it twice.
const liveRunners = new Map<string, Promise<void>>();

export function isRunnerLive(jobId: string): boolean {
  return liveRunners.has(jobId);
}

/** Settles when the job's runner stops, or right away when none is alive. */
export function runnerSettled(jobId: string): Promise<void> {
  return liveRunners.get(jobId) ?? Promise.resolve();
}

// Three tries for a network-ish failure; a provider's own 4xx answer won't change on a retry.
const LINKS_MAX_ATTEMPTS = 3;
const LINKS_RETRY_DELAY_MS = 2000;

function isTransientImportFailure(err: unknown): boolean {
  return !(err instanceof HttpError) || err.transient === true;
}

function failureMessage(err: unknown): string {
  return err instanceof Error && err.message.trim() ? err.message.trim() : "Import failed";
}

/** One queued link. A MakerWorld model with a multi-profile scope imports each wanted profile onto
 *  one print, like the PROFILES job; anything else is a plain single import. `profiles` marks the
 *  former, whose totals count print profiles rather than models. */
async function importOneLink(
  userId: string,
  url: string,
  body: LinksImportJobBody,
): Promise<ProfileImportTotals & { profiles: boolean }> {
  const parsed = parseMakerworldModelUrl(url);
  if (parsed && body.scope && body.scope !== "url") {
    const design = await fetchMakerworldDesignForImport(
      parsed.designId,
      resolveMakerworldCookie(body),
      IMPORT_MAKERWORLD_CALL_DELAY_MS,
    );
    if (!design) throw new HttpError(400, "Couldn't read this model's print profiles from MakerWorld");
    const profileIds = selectMakerworldProfiles(design, body.scope, parsed.requestedInstanceId);
    if (!profileIds.length) throw new HttpError(400, "This model has no print profiles to import");
    const totals = await importProfileUrlsSequentially(
      userId,
      profileIds.map((profileId) => `https://makerworld.com/en/models/${parsed.designId}#profileId-${profileId}`),
      { ...body, url },
    );
    return { ...totals, profiles: true };
  }
  const result = await importPrintFromUrl(userId, url, { ...body, url });
  return {
    processed: 1,
    imported: result.alreadyImported ? 0 : 1,
    alreadyInLibrary: result.alreadyImported ? 1 : 0,
    failed: 0,
    printId: result.print.id,
    stopReason: null,
    profiles: false,
  };
}

/** Imports a queued list of links, one at a time (parallel bursts trip MakerWorld's CAPTCHA).
 *  A transient failure is retried in place; what still fails stays FAILED on its item so
 *  POST /import/jobs/:id/retry can rerun just those. Also rerun by that route after a CAPTCHA
 *  cooloff or a cookie update. */
export function runLinksImportJob(jobId: string, userId: string, body: LinksImportJobBody): Promise<void> {
  if (liveRunners.has(jobId)) {
    console.warn(`[import] job ${jobId}: a runner is already working on it, not starting another`);
    return Promise.resolve();
  }
  const run = runLinks(jobId, userId, body).finally(() => {
    if (liveRunners.get(jobId) === run) liveRunners.delete(jobId);
  });
  liveRunners.set(jobId, run);
  return run;
}

async function runLinks(jobId: string, userId: string, body: LinksImportJobBody): Promise<void> {
  try {
    const job = await getJob(jobId, userId);
    if (!job) throw new HttpError(404, "Import job not found");
    const items = (await listJobItems(jobId)).filter((item) => item.status === "PENDING");
    const total = await countJobItems(jobId, { in: ["PENDING", "RUNNING", "DONE", "FAILED"] });
    console.log(`[import] job ${jobId}: running ${items.length} of ${total} links`);

    let imported = 0;
    let alreadyInLibrary = 0;
    // This run's print profiles, from links with a profile scope; the counts above are models.
    let profilesImported = 0;
    let profilesProcessed = 0;
    let printId: string | null = null;
    let stopReason: StopReason | null = null;
    let processed = (await countJobItems(jobId, "DONE")) + (await countJobItems(jobId, "FAILED"));

    for (const item of items) {
      // Pausing only flips the status; the link that's importing finishes and the rest wait.
      if ((await getJobStatus(jobId)) === "PAUSED") {
        console.log(`[import] job ${jobId}: paused, ${processed} of ${total} links processed`);
        return;
      }
      const options = parseQueuedLinkOptions(item.payload);
      const itemBody: LinksImportJobBody = options.scope ? { ...body, scope: options.scope } : body;
      await updateJobItem(item.id, { status: "RUNNING" }).catch(() => undefined);
      let attempts = item.attempts;
      let itemError: string | null = null;
      let settled = false;
      while (!settled) {
        attempts++;
        if (stopReason) {
          itemError = {
            rateLimited: "blocked by a MakerWorld CAPTCHA challenge — retry once it clears (usually 1-4 hours)",
            downloadLimit: "MakerWorld's daily download limit was reached — retry tomorrow",
            auth: "the MakerWorld session expired — update the cookie in Settings, then retry",
          }[stopReason];
          settled = true;
          break;
        }
        try {
          const result = await importOneLink(userId, item.url, itemBody);
          // A link is one model however many of its profiles came in.
          if (result.imported) imported++;
          else if (result.alreadyInLibrary) alreadyInLibrary++;
          if (result.profiles) {
            profilesImported += result.imported;
            profilesProcessed += result.processed;
          }
          if (result.printId) printId = result.printId;
          if (result.printId && options.collection_id) {
            await fileIntoCollection(userId, options.collection_id, result.printId);
          }
          if (result.failed) {
            // Some of the model's profiles got in; the rest are a manual retry's job, since
            // rerunning right away would only re-meet the same CAPTCHA.
            itemError = `${result.failed} of ${result.processed} print profiles failed`;
            if (result.stopReason) {
              stopReason = result.stopReason;
              itemError += {
                rateLimited: " (MakerWorld CAPTCHA challenge — retry once it clears)",
                downloadLimit: " (MakerWorld's daily download limit — retry tomorrow)",
                auth: " (the MakerWorld session expired — update the cookie in Settings, then retry)",
              }[result.stopReason];
            }
            settled = true;
          } else {
            itemError = null;
            settled = true;
          }
        } catch (err) {
          itemError = failureMessage(err);
          stopReason = asStopReason(classifyImportFailure(err)) ?? stopReason;
          if (!isTransientImportFailure(err) || attempts >= LINKS_MAX_ATTEMPTS) {
            settled = true;
          } else {
            console.warn(
              `[import] job ${jobId}: ${item.url} failed (${itemError}), retrying (attempt ${attempts + 1} of ${LINKS_MAX_ATTEMPTS})`,
            );
            await sleep(LINKS_RETRY_DELAY_MS * attempts);
          }
        }
      }
      if (itemError) console.error(`[import] job ${jobId}: ${item.url} failed: ${itemError}`);
      else console.log(`[import] job ${jobId}: ${item.url} imported`);
      await updateJobItem(item.id, {
        status: itemError ? "FAILED" : "DONE",
        attempts,
        errorMessage: itemError,
      }).catch(() => undefined);
      processed++;
      await updateJob(jobId, {
        processed,
        imported: job.imported + imported,
        alreadyInLibrary: job.alreadyInLibrary + alreadyInLibrary,
        failedCount: await countJobItems(jobId, "FAILED"),
      }).catch(() => undefined);
    }

    const totalImported = job.imported + imported;
    const failedCount = await countJobItems(jobId, "FAILED");
    console.log(
      `[import] job ${jobId}: done, ${totalImported} imported, ${job.alreadyInLibrary + alreadyInLibrary} already in library, ${failedCount} failed`,
    );
    await updateJob(jobId, {
      status: "DONE",
      processed,
      imported: totalImported,
      alreadyInLibrary: job.alreadyInLibrary + alreadyInLibrary,
      failedCount,
      resultPrintId: totalImported === 1 ? (printId ?? job.resultPrintId) : null,
    });
    void createLog({
      userId,
      action: "import_completed",
      targetId: printId ?? job.resultPrintId,
      details: { provider: "links", imported, alreadyInLibrary, failed: failedCount },
    });

    const bodyParts: string[] = [];
    if (profilesProcessed) bodyParts.push(`${profilesImported} of ${profilesProcessed} print profiles imported`);
    if (alreadyInLibrary) bodyParts.push(`${alreadyInLibrary} already in your library`);
    if (stopReason === "rateLimited") {
      bodyParts.push(
        `the rest blocked by a MakerWorld CAPTCHA challenge — this usually clears in 1-4 hours, then retry the failed links`,
      );
    } else if (stopReason === "downloadLimit") {
      bodyParts.push(
        `the rest not downloaded — MakerWorld's daily download limit was reached, retry the failed links tomorrow`,
      );
    } else if (stopReason === "auth") {
      bodyParts.push(
        `the rest failed because your MakerWorld session expired — update the cookie in Settings, then retry`,
      );
    } else if (failedCount) {
      bodyParts.push(`${failedCount} failed — retry them from the import's progress bar`);
    }
    await createNotification(userId, {
      title: `Imported ${totalImported} of ${total} models`,
      body: bodyParts.length ? `${bodyParts.join(", ")}.` : null,
      externalUrl: job.sourceUrl,
      internalPath:
        totalImported === 1 && (printId ?? job.resultPrintId) ? `/models/${printId ?? job.resultPrintId}` : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

/** The collection picked in the extension's panel. Checked against the owner at run time, since
 *  it may have been deleted while the link waited in the queue; a miss doesn't fail the link. */
async function fileIntoCollection(userId: string, collectionId: string, printId: string): Promise<void> {
  try {
    const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId } });
    if (collection) await addPrintsToCollection(collection.id, [printId]);
  } catch (err) {
    console.warn(`[import] couldn't add ${printId} to collection ${collectionId}:`, err);
  }
}
