import { describe, expect, it } from "vitest";
import { bestScore, matchScore, MIN_COMMAND_SCORE, minScoreFor } from "./match";

describe("matchScore", () => {
  it("ranks exact, prefix, word prefix, initials, substring, then letters in order", () => {
    const scores = [
      matchScore("theme: dark", "Theme: Dark"),
      matchScore("the", "Theme: Dark"),
      matchScore("dar", "Theme: Dark"),
      matchScore("td", "Theme: Dark"),
      matchScore("eme", "Theme: Dark"),
      matchScore("tmd", "Theme: Dark"),
    ];
    expect(scores).toEqual(scores.toSorted((a, b) => b - a));
    expect(new Set(scores).size).toBe(scores.length);
  });

  it("doesn't match missing letters or an empty query", () => {
    expect(matchScore("xyz", "Theme: Dark")).toBe(0);
    expect(matchScore("  ", "Theme: Dark")).toBe(0);
  });
});

describe("bestScore", () => {
  it("lets a keyword match, below a name match", () => {
    const viaKeyword = bestScore("night", "Theme: Dark", ["night mode"]);
    expect(viaKeyword).toBeGreaterThanOrEqual(MIN_COMMAND_SCORE);
    expect(viaKeyword).toBeLessThan(bestScore("theme", "Theme: Dark", ["night mode"]));
  });
});

describe("minScoreFor", () => {
  it("needs one letter to start a word, but lets longer queries match inside one", () => {
    expect(matchScore("d", "Models")).toBeLessThan(minScoreFor("d"));
    expect(matchScore("d", "Theme: Dark")).toBeGreaterThanOrEqual(minScoreFor("d"));
    expect(matchScore("del", "Models")).toBeGreaterThanOrEqual(minScoreFor("del"));
  });
});
