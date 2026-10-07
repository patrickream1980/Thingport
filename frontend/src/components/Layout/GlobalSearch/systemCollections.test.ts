import { describe, expect, it } from "vitest";
import { matchSystemCollections } from "./systemCollections";

const EN = { favorites: "Favourites", history: "Browsing History" };
const LT = { favorites: "Mėgstamiausi", history: "Naršymo istorija" };

describe("matchSystemCollections", () => {
  it("matches the shown name, by prefix or any word", () => {
    expect(matchSystemCollections("fav", EN)).toEqual(["favorites"]);
    expect(matchSystemCollections("brows", EN)).toEqual(["history"]);
    expect(matchSystemCollections("hist", EN)).toEqual(["history"]);
    expect(matchSystemCollections("istor", LT)).toEqual(["history"]);
  });

  it("matches the extra terms, in English whatever the language", () => {
    expect(matchSystemCollections("favorites", EN)).toEqual(["favorites"]);
    expect(matchSystemCollections("starred", LT)).toEqual(["favorites"]);
    expect(matchSystemCollections("recently viewed", EN)).toEqual(["history"]);
  });

  it("matches neither for an unrelated query", () => {
    expect(matchSystemCollections("dragon", EN)).toEqual([]);
  });
});
