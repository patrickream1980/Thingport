import { describe, expect, it } from "vitest";
import { matchPages, SEARCH_PAGES, type PageId } from "./pages";

const EN: Record<PageId, string> = {
  dashboard: "Dashboard",
  models: "Models",
  collections: "Collections",
  tags: "Tags",
  downloads: "Downloads",
  myModels: "My models",
  profile: "Profile",
};
const ids = (query: string) => matchPages(query, EN).map((page) => page.id);

describe("matchPages", () => {
  it("matches the shown name from the first letter, best first", () => {
    expect(ids("d")).toEqual(["dashboard", "downloads"]);
    expect(ids("prof")).toEqual(["profile"]);
    expect(ids("models")[0]).toBe("models");
    expect(ids("my")).toEqual(["myModels"]);
  });

  it("matches the extra terms", () => {
    expect(ids("bridge")).toEqual(["downloads"]);
    expect(ids("account")).toEqual(["profile"]);
    expect(ids("home")).toEqual(["dashboard"]);
  });

  it("leaves admin pages out", () => {
    expect(ids("admin")).toEqual([]);
    expect(SEARCH_PAGES.some((page) => page.path.startsWith("/admin"))).toBe(false);
  });
});
