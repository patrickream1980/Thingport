import { describe, expect, it } from "vitest";
import { bangArgument, bangText, isBangQuery, matchBang, type Command } from "./commands";

const COMMANDS: Command[] = [
  { id: "theme-dark", bang: "theme", arg: "dark", label: "Theme: Dark", keywords: [] },
  { id: "theme-light", bang: "theme", arg: "light", label: "Theme: Light", keywords: [] },
  { id: "theme-system", bang: "theme", arg: "system", argAlias: "auto", label: "Theme: System", keywords: [] },
  { id: "logout", bang: "logout", label: "Log out", keywords: [] },
  { id: "import", bang: "import", label: "Import", keywords: [] },
];
const ids = (query: string) => matchBang(query, COMMANDS).map((c) => c.id);

describe("matchBang", () => {
  it("lists every command for a bare !", () => {
    expect(ids("!")).toHaveLength(COMMANDS.length);
  });

  it("lists the commands a partial bang could become", () => {
    expect(ids("!th")).toEqual(["theme-dark", "theme-light", "theme-system"]);
    expect(ids("!lo")).toEqual(["logout"]);
    expect(ids("!i")).toEqual(["import"]);
  });

  it("narrows a whole bang by its argument or alias", () => {
    expect(ids("!theme")).toHaveLength(3);
    expect(ids("!theme d")).toEqual(["theme-dark"]);
    expect(ids("!THEME Light")).toEqual(["theme-light"]);
    expect(ids("!theme auto")).toEqual(["theme-system"]);
  });

  it("keeps a command without arguments whatever follows it", () => {
    expect(ids("!import https://www.printables.com/model/1-x")).toEqual(["import"]);
  });

  it("matches nothing for an unknown bang, a bad argument, or no bang", () => {
    expect(ids("!nope")).toEqual([]);
    expect(ids("!nope dark")).toEqual([]);
    expect(ids("!theme purple")).toEqual([]);
    expect(ids("theme")).toEqual([]);
  });
});

describe("helpers", () => {
  it("spots a ! query and writes a command out", () => {
    expect(isBangQuery("  !th")).toBe(true);
    expect(isBangQuery("dragon")).toBe(false);
    expect(bangText(COMMANDS[0])).toBe("!theme dark");
    expect(bangText(COMMANDS[3])).toBe("!logout");
  });

  it("reads what follows a bang, case kept", () => {
    expect(bangArgument("!import  https://MakerWorld.com/en/models/1 ")).toBe("https://MakerWorld.com/en/models/1");
    expect(bangArgument("!import")).toBe("");
    expect(bangArgument("import x")).toBe("");
  });
});
