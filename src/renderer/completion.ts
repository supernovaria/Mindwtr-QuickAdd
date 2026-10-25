// Inline autocomplete for marker tokens (currently `!Area`): finds the token
// being typed at the caret, ranks matching names, and builds the completed text.

export const MAX_SUGGESTIONS = 5;

export interface ActiveToken {
  marker: string;
  /** Text typed after the marker, up to the caret. */
  query: string;
  /** Offset of the marker in the input. */
  start: number;
  /** End of the word under the caret (the caret may sit mid-word). */
  end: number;
}

/**
 * The marker token the caret is in, if it starts with a letter. `!1`..`!4`
 * (priority) and a bare `!` don't count, so suggestions only open once a
 * letter follows the marker.
 */
export function activeToken(text: string, caret: number, marker: string): ActiveToken | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf(marker);
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(before[start - 1])) return null;
  const query = before.slice(start + marker.length);
  if (!/^\p{L}[^\s"'!@#+%/]*$/u.test(query)) return null;
  const rest = text.slice(caret).match(/^[^\s]*/)?.[0] ?? '';
  return { marker, query, start, end: caret + rest.length };
}

const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

/** Names that match the query: prefix matches first, then word starts, then anywhere. */
export function rankSuggestions(names: readonly string[], query: string): string[] {
  const q = normalize(query);
  const scored: { name: string; score: number; index: number }[] = [];
  names.forEach((name, index) => {
    const n = normalize(name);
    let score: number;
    if (n.startsWith(q)) score = 0;
    else if (n.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q))) score = 1;
    else if (n.includes(q)) score = 2;
    else return;
    scored.push({ name, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, MAX_SUGGESTIONS).map((item) => item.name);
}

/** The token as Mindwtr's parser reads it: quoted when the name has anything but word characters. */
export function formatToken(marker: string, name: string): string {
  return /^[\p{L}\p{N}_-]+$/u.test(name) ? `${marker}${name}` : `${marker}"${name.replace(/(["\\])/g, '\\$1')}"`;
}

/** Replaces the active token with the chosen name and puts the caret after the following space. */
export function applyCompletion(text: string, token: ActiveToken, name: string): { text: string; caret: number } {
  const inserted = formatToken(token.marker, name);
  const after = text.slice(token.end);
  const spacer = after.startsWith(' ') ? '' : ' ';
  const next = text.slice(0, token.start) + inserted + spacer + after;
  return { text: next, caret: token.start + inserted.length + 1 };
}
