import { describe, expect, it } from "vitest";
import { withRecent, type RecentEntry } from "./recents";

const entry = (id: string): RecentEntry => ({ key: `model:${id}`, kind: "model", title: id, path: `/models/${id}` });

describe("withRecent", () => {
  it("puts the newest first and doesn't repeat an entry", () => {
    const list = withRecent(withRecent(withRecent([], entry("a")), entry("b")), entry("a"));
    expect(list.map((e) => e.title)).toEqual(["a", "b"]);
  });

  it("keeps at most ten", () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 15; i++) list = withRecent(list, entry(String(i)));
    expect(list).toHaveLength(10);
    expect(list[0].title).toBe("14");
  });
});
