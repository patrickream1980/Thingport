// Toolbar and shortcut edits for a Markdown textarea. Each returns the range of the current text
// to replace, what to put there, and what to select afterwards, so the caller can apply it as a
// single undoable edit.

export type Selection = { start: number; end: number };

export type MarkdownEdit = {
  /** Range of the current text to replace. */
  start: number;
  end: number;
  insert: string;
  /** Selection in the resulting text. */
  select: Selection;
};

export type InlineStyle = "bold" | "italic" | "code";
export type LineStyle = "heading" | "bullet" | "numbered" | "quote";

const INLINE_MARKERS: Record<InlineStyle, string> = { bold: "**", italic: "*", code: "`" };

/** Wraps the selection in the style's marker, or unwraps it when it already has it. */
export function toggleInline(value: string, sel: Selection, style: InlineStyle, placeholder: string): MarkdownEdit {
  const selected = value.slice(sel.start, sel.end);
  if (style === "code" && selected.includes("\n")) return codeBlock(sel, selected);
  const marker = INLINE_MARKERS[style];
  const m = marker.length;

  // Markers just outside the selection, but not part of a longer run (italic inside **bold**).
  const before = value.slice(sel.start - m, sel.start);
  const after = value.slice(sel.end, sel.end + m);
  const runBefore = value[sel.start - m - 1] === marker[0];
  const runAfter = value[sel.end + m] === marker[0];
  if (before === marker && after === marker && !runBefore && !runAfter) {
    const start = sel.start - m;
    return { start, end: sel.end + m, insert: selected, select: { start, end: start + selected.length } };
  }
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    return { ...sel, insert: inner, select: { start: sel.start, end: sel.start + inner.length } };
  }
  const text = selected || placeholder;
  return {
    ...sel,
    insert: `${marker}${text}${marker}`,
    select: { start: sel.start + m, end: sel.start + m + text.length },
  };
}

function codeBlock(sel: Selection, selected: string): MarkdownEdit {
  const insert = `\`\`\`\n${selected.replace(/\n$/, "")}\n\`\`\``;
  return { ...sel, insert, select: { start: sel.start + 4, end: sel.start + insert.length - 4 } };
}

const LINE_PREFIX: Record<LineStyle, RegExp> = {
  heading: /^#{1,6} /,
  bullet: /^[-*+] /,
  numbered: /^\d+\. /,
  quote: /^> ?/,
};
// Switching between list kinds replaces the other kind's marker instead of stacking both.
const ANY_LIST_PREFIX = /^([-*+]|\d+\.) /;

/** Adds the style's prefix to every selected line, or removes it when all of them have it. */
export function toggleLines(value: string, sel: Selection, style: LineStyle): MarkdownEdit {
  const start = value.lastIndexOf("\n", sel.start - 1) + 1;
  // A selection ending right after a newline doesn't take in the next line.
  const endFrom = sel.end > sel.start && value[sel.end - 1] === "\n" ? sel.end - 1 : sel.end;
  const newline = value.indexOf("\n", endFrom);
  const end = newline === -1 ? value.length : newline;
  const lines = value.slice(start, end).split("\n");

  const prefix = LINE_PREFIX[style];
  const content = lines.filter((line) => line.trim());
  const remove = content.length > 0 && content.every((line) => prefix.test(line));
  let number = 0;
  const next = lines.map((line) => {
    if (remove) return line.replace(prefix, "");
    if (!line.trim() && lines.length > 1) return line;
    const bare = style === "bullet" || style === "numbered" ? line.replace(ANY_LIST_PREFIX, "") : line;
    const stripped = bare.replace(prefix, "");
    if (style === "heading") return `## ${stripped}`;
    if (style === "bullet") return `- ${stripped}`;
    if (style === "numbered") return `${++number}. ${stripped}`;
    return `> ${stripped}`;
  });
  const insert = next.join("\n");
  const caretOnly = sel.start === sel.end && lines.length === 1;
  return {
    start,
    end,
    insert,
    select: caretOnly
      ? { start: start + insert.length, end: start + insert.length }
      : { start, end: start + insert.length },
  };
}

/** `[text](url)`, selecting whichever part still needs typing. */
export function insertLink(value: string, sel: Selection, placeholders: { text: string; url: string }): MarkdownEdit {
  return linkLike(value, sel, "", placeholders);
}

/** `![alt](url)` on its own line, with the URL selected for pasting. */
export function insertImage(value: string, sel: Selection, placeholders: { text: string; url: string }): MarkdownEdit {
  const edit = linkLike(value, sel, "!", placeholders);
  const lead = sel.start > 0 && value[sel.start - 1] !== "\n" ? "\n\n" : "";
  const trail = sel.end < value.length && value[sel.end] !== "\n" ? "\n\n" : "";
  return {
    ...edit,
    insert: `${lead}${edit.insert}${trail}`,
    select: { start: edit.select.start + lead.length, end: edit.select.end + lead.length },
  };
}

function linkLike(
  value: string,
  sel: Selection,
  bang: string,
  placeholders: { text: string; url: string },
): MarkdownEdit {
  const selected = value.slice(sel.start, sel.end).trim();
  const isUrl = /^https?:\/\/\S+$/i.test(selected);
  const text = isUrl ? placeholders.text : selected || placeholders.text;
  const url = isUrl ? selected : placeholders.url;
  const insert = `${bang}[${text}](${url})`;
  const textStart = sel.start + bang.length + 1;
  const urlStart = textStart + text.length + 2;
  // A selected URL still needs its text; anything else needs its URL.
  const select = isUrl
    ? { start: textStart, end: textStart + text.length }
    : { start: urlStart, end: urlStart + url.length };
  return { ...sel, insert, select };
}

/** The text after applying an edit. */
export function applyEdit(value: string, edit: MarkdownEdit): string {
  return value.slice(0, edit.start) + edit.insert + value.slice(edit.end);
}
