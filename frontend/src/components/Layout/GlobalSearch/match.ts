// Fuzzy scoring, higher is better and 0 is no match. Order of preference: whole-name prefix, word
// prefix, initials ("td" → Theme: Dark), substring, then letters in order.
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = (text || "").toLowerCase();
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90 - Math.min(t.length - q.length, 20) / 4;
  const words = t.split(/[\s\-_./·:]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 70;
  if (
    words.length > 1 &&
    words
      .map((w) => w[0])
      .join("")
      .startsWith(q)
  )
    return 65;
  const at = t.indexOf(q);
  if (at >= 0) return 50 - Math.min(at, 20) / 2;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length && q.length >= 2 ? 20 : 0;
}

/** Best score across a label and its keywords; keywords count for a little less so a name match
 *  always wins. */
export function bestScore(query: string, title: string, keywords: string[] = []): number {
  let best = matchScore(query, title);
  for (const k of keywords) best = Math.max(best, matchScore(query, k) * 0.8);
  return best;
}

/** 45+ is a substring or better; letters-in-order alone is too loose to list. */
export const MIN_COMMAND_SCORE = 45;

/** The score a match needs: from one letter even a substring is noise ("d" in "Models"), so the
 *  letter must start a word. */
export function minScoreFor(query: string): number {
  return query.trim().length < 2 ? 65 : MIN_COMMAND_SCORE;
}
