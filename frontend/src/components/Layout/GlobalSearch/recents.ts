// Opened search results, newest first, in this browser's storage.
const STORAGE_KEY = "thingport_search_recents";
// Kept beyond what's shown, so a result that's deleted or renamed doesn't leave the list short.
const MAX_STORED = 10;
export const RECENTS_SHOWN = 3;

export type RecentKind = "model" | "collection" | "tag" | "page";

export type RecentEntry = {
  /** `${kind}:${id}`, unique across kinds. */
  key: string;
  kind: RecentKind;
  title: string;
  subtitle?: string;
  /** Relative, like the API returns it; the token is added when it's shown. */
  thumbUrl?: string | null;
  path: string;
};

function isEntry(value: unknown): value is RecentEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === "string" &&
    typeof v.title === "string" &&
    typeof v.path === "string" &&
    (v.kind === "model" || v.kind === "collection" || v.kind === "tag" || v.kind === "page")
  );
}

/** Moves `entry` to the front, dropping its older copy and anything past the cap. */
export function withRecent(list: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...list.filter((e) => e.key !== entry.key)].slice(0, MAX_STORED);
}

// Storage can be missing or throw (private windows, blocked site data); that just means no recents.
export function readRecents(): RecentEntry[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function addRecent(entry: RecentEntry): RecentEntry[] {
  const next = withRecent(readRecents(), entry);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}
