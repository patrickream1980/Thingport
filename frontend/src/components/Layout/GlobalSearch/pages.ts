import { SELF_AUTHOR_ID } from "../../../constants/selfAuthor";
import { bestScore, minScoreFor } from "./match";

// The app's own views. Admin pages are left out on purpose.
export type PageId = "dashboard" | "models" | "collections" | "tags" | "downloads" | "myModels" | "profile";

export type SearchPage = {
  id: PageId;
  path: string;
  /** The name as the sidebar or user menu shows it. */
  labelKey: string;
  /** Lower case; English whatever the UI language, as people often search in it anyway. */
  terms: string[];
};

export const SEARCH_PAGES: SearchPage[] = [
  { id: "dashboard", path: "/", labelKey: "app:sidebar.dashboard", terms: ["home", "overview", "stats"] },
  { id: "models", path: "/models", labelKey: "app:sidebar.models", terms: ["library", "prints", "all models"] },
  { id: "collections", path: "/models/collections", labelKey: "app:sidebar.collections", terms: ["collections"] },
  { id: "tags", path: "/models/tags", labelKey: "app:sidebar.tags", terms: ["tags", "labels"] },
  {
    id: "downloads",
    path: "/downloads",
    labelKey: "app:sidebar.downloads",
    terms: ["downloads", "bridge", "extension", "browser extension", "install"],
  },
  {
    id: "myModels",
    path: `/authors/${SELF_AUTHOR_ID}`,
    labelKey: "app:userMenu.myModels",
    terms: ["my models", "my uploads", "uploads", "mine"],
  },
  {
    id: "profile",
    path: "/profile",
    labelKey: "app:profile.title",
    terms: ["profile", "account", "settings", "preferences", "email", "password"],
  },
];

/** The pages `query` matches, best first. `labels` are their names as shown. */
export function matchPages(query: string, labels: Record<PageId, string>): SearchPage[] {
  return SEARCH_PAGES.map((page) => ({ page, score: bestScore(query, labels[page.id], page.terms) }))
    .filter((match) => match.score >= minScoreFor(query))
    .toSorted((a, b) => b.score - a.score)
    .map((match) => match.page);
}
