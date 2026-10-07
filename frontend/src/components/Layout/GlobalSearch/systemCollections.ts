import type { SystemCollectionKey } from "../../../api/collections";
import { bestScore, MIN_COMMAND_SCORE } from "./match";

// Favourites and Browsing History aren't stored as collections, so the backend search never finds
// them; they're matched here on their shown name plus these terms (lower case, English).
export const SYSTEM_COLLECTION_TERMS: Record<SystemCollectionKey, string[]> = {
  favorites: ["favourites", "favorites", "favs", "starred", "stars", "liked", "likes"],
  history: ["history", "browsing history", "recently viewed", "viewed", "recent", "visited"],
};

/** The system collections `query` matches, best first. `names` are their names as shown. */
export function matchSystemCollections(
  query: string,
  names: Record<SystemCollectionKey, string>,
): SystemCollectionKey[] {
  return (Object.keys(SYSTEM_COLLECTION_TERMS) as SystemCollectionKey[])
    .map((key) => ({ key, score: bestScore(query, names[key], SYSTEM_COLLECTION_TERMS[key]) }))
    .filter((match) => match.score >= MIN_COMMAND_SCORE)
    .toSorted((a, b) => b.score - a.score)
    .map((match) => match.key);
}
