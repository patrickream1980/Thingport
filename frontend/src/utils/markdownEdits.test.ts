import { describe, expect, it } from "vitest";
import {
  applyEdit,
  insertImage,
  insertLink,
  toggleInline,
  toggleLines,
  type MarkdownEdit,
  type Selection,
} from "./markdownEdits";

/** Writes a selection into the text as [ and ] markers (| for a caret) so results read at a glance. */
function show(value: string, edit: MarkdownEdit): string {
  const next = applyEdit(value, edit);
  const { start, end } = edit.select;
  if (start === end) return `${next.slice(0, start)}|${next.slice(start)}`;
  return `${next.slice(0, start)}[${next.slice(start, end)}]${next.slice(end)}`;
}

/** The reverse of show: "a [b] c" is "a b c" with "b" selected. */
function parse(marked: string): { value: string; sel: Selection } {
  const caret = marked.indexOf("|");
  if (caret !== -1) return { value: marked.replace("|", ""), sel: { start: caret, end: caret } };
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace("[", "").replace("]", ""), sel: { start, end } };
}

describe("toggleInline", () => {
  it("wraps the selection, keeping it selected", () => {
    const { value, sel } = parse("make [this] bold");
    expect(show(value, toggleInline(value, sel, "bold", "bold text"))).toBe("make **[this]** bold");
  });

  it("unwraps a selection that is already wrapped", () => {
    const { value, sel } = parse("make **[this]** bold");
    expect(show(value, toggleInline(value, sel, "bold", "bold text"))).toBe("make [this] bold");
  });

  it("inserts a selected placeholder at a caret", () => {
    const { value, sel } = parse("say |");
    expect(show(value, toggleInline(value, sel, "italic", "italic text"))).toBe("say *[italic text]*");
  });

  it("doesn't mistake bold markers for italic ones", () => {
    const { value, sel } = parse("**[word]**");
    expect(show(value, toggleInline(value, sel, "italic", "x"))).toBe("***[word]***");
  });

  it("fences a multi-line code selection", () => {
    const { value, sel } = parse("[a\nb]");
    expect(applyEdit(value, toggleInline(value, sel, "code", "code"))).toBe("```\na\nb\n```");
  });
});

describe("toggleLines", () => {
  it("numbers every selected line, replacing bullets", () => {
    const { value, sel } = parse("intro\n[- one\n- two]\noutro");
    expect(applyEdit(value, toggleLines(value, sel, "numbered"))).toBe("intro\n1. one\n2. two\noutro");
  });

  it("removes the prefix when every selected line has it, skipping blank lines", () => {
    const { value, sel } = parse("[> a\n\n> b]");
    expect(applyEdit(value, toggleLines(value, sel, "quote"))).toBe("a\n\nb");
  });

  it("turns the caret's line into a heading and keeps the caret at its end", () => {
    const { value, sel } = parse("Ti|tle\nbody");
    expect(show(value, toggleLines(value, sel, "heading"))).toBe("## Title|\nbody");
  });

  it("doesn't take in the line after a selection ending in a newline", () => {
    const { value, sel } = parse("[a\n]b");
    expect(applyEdit(value, toggleLines(value, sel, "bullet"))).toBe("- a\nb");
  });
});

describe("insertLink and insertImage", () => {
  const placeholders = { text: "link text", url: "https://" };

  it("makes selected text a link and selects the URL to type", () => {
    const { value, sel } = parse("see [the guide]");
    const edit = insertLink(value, sel, placeholders);
    expect(applyEdit(value, edit)).toBe("see [the guide](https://)");
    expect(applyEdit(value, edit).slice(edit.select.start, edit.select.end)).toBe("https://");
  });

  it("makes a selected URL the link target and selects the text to type", () => {
    const { value, sel } = parse("[https://example.com]");
    const edit = insertLink(value, sel, placeholders);
    expect(applyEdit(value, edit)).toBe("[link text](https://example.com)");
    expect(applyEdit(value, edit).slice(edit.select.start, edit.select.end)).toBe("link text");
  });

  it("puts an image on its own line", () => {
    const { value, sel } = parse("before|after");
    const edit = insertImage(value, sel, { text: "image", url: "https://" });
    expect(applyEdit(value, edit)).toBe("before\n\n![image](https://)\n\nafter");
    expect(applyEdit(value, edit).slice(edit.select.start, edit.select.end)).toBe("https://");
  });
});
