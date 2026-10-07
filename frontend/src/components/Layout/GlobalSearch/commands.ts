// Bang commands: "!theme dark" runs a command directly, "!" alone lists them all.

export type Command = {
  id: string;
  /** Typed after "!", e.g. "theme". */
  bang: string;
  /** Narrows a bang with several commands, e.g. "dark" in "!theme dark". */
  arg?: string;
  /** Another word the argument matches, e.g. "auto" for "system". */
  argAlias?: string;
  label: string;
  keywords: string[];
};

const FULL_BANG = /^!([a-zA-Z0-9_-]+)(?:\s+(.*))?$/;
const PARTIAL_BANG = /^!([a-zA-Z0-9_-]*)$/;

export function isBangQuery(query: string): boolean {
  return query.trimStart().startsWith("!");
}

/** What follows a whole bang as typed, case kept: the link in "!import https://…". */
export function bangArgument(query: string): string {
  return query.trimStart().match(FULL_BANG)?.[2]?.trim() ?? "";
}

/** How a "!" command is written out, shown as each command's subtitle. */
export function bangText(command: Command): string {
  return `!${command.bang}${command.arg ? ` ${command.arg}` : ""}`;
}

/**
 * The commands a "!" query matches. A whole bang ("!theme", "!theme d") gives its commands,
 * filtered by the argument; a bare or partial one ("!", "!th") gives every command it could still
 * become. Anything else, e.g. an unknown bang with an argument, matches nothing.
 */
export function matchBang<T extends Command>(query: string, commands: T[]): T[] {
  const s = query.trimStart();
  if (!s.startsWith("!")) return [];
  const full = s.match(FULL_BANG);
  if (full) {
    const bang = full[1].toLowerCase();
    const arg = (full[2] ?? "").trim().toLowerCase();
    const hits = commands.filter((c) => c.bang === bang);
    if (hits.length) {
      return arg ? hits.filter((c) => !c.arg || c.arg.includes(arg) || c.argAlias?.includes(arg)) : hits;
    }
  }
  const partial = s.match(PARTIAL_BANG);
  if (!partial) return [];
  const prefix = partial[1].toLowerCase();
  return commands.filter((c) => c.bang.startsWith(prefix));
}
