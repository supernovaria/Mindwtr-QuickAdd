// Inline autocomplete for marker tokens (`!Area`, `+Project`): finds the token
// being typed at the caret, ranks matching names, and builds the completed text.
// Also finds an empty date command (`due:`, `/start:`, ...) at the caret, where
// the date picker opens.

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
 * The marker token the caret is in, once at least `minChars` characters follow
 * the marker. A typed query must start with a letter, so `!1`..`!4` (priority)
 * never open suggestions.
 */
export function activeToken(text: string, caret: number, marker: string, minChars = 1): ActiveToken | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf(marker);
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(before[start - 1])) return null;
  const query = before.slice(start + marker.length);
  if (query.length < minChars) return null;
  if (query && !/^\p{L}[^\s"'!@#+%/]*$/u.test(query)) return null;
  const rest = text.slice(caret).match(/^[^\s]*/)?.[0] ?? '';
  return { marker, query, start, end: caret + rest.length };
}

const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

/**
 * Names that match the query: prefix matches first, then word starts, then
 * anywhere. An empty query matches every name. `max` null = no limit.
 */
export function rankSuggestions(names: readonly string[], query: string, max: number | null = 5): string[] {
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
  return (max === null ? scored : scored.slice(0, max)).map((item) => item.name);
}

/** The token as Mindwtr's parser reads it: quoted when the name has anything but word characters. */
export function formatToken(marker: string, name: string): string {
  return /^[\p{L}\p{N}_-]+$/u.test(name) ? `${marker}${name}` : `${marker}"${name.replace(/(["\\])/g, '\\$1')}"`;
}

/** Replaces the active token with the chosen name and puts the caret after the following space. */
export function applyCompletion(text: string, token: ActiveToken, name: string): { text: string; caret: number } {
  return replaceRange(text, token.start, token.end, formatToken(token.marker, name));
}

export type DateCommand = 'start' | 'due' | 'review';

export interface ActiveDateCommand {
  command: DateCommand;
  /** Where the date goes: right after the colon, at the caret. */
  at: number;
}

/** A `start:`/`due:`/`review:` command (slash optional) with nothing typed after it yet. */
export function activeDateCommand(text: string, caret: number): ActiveDateCommand | null {
  const match = text.slice(0, caret).match(/(?:^|\s)\/?(start|due|review):$/i);
  if (!match) return null;
  if (/^\S/.test(text.slice(caret))) return null;
  return { command: match[1].toLowerCase() as DateCommand, at: caret };
}

/** Inserts the picked date (YYYY-MM-DD) at the command and moves the caret past a space. */
export function applyDate(text: string, command: ActiveDateCommand, isoDate: string): { text: string; caret: number } {
  return replaceRange(text, command.at, command.at, isoDate);
}

function replaceRange(text: string, start: number, end: number, inserted: string): { text: string; caret: number } {
  const after = text.slice(end);
  const spacer = after.startsWith(' ') ? '' : ' ';
  return { text: text.slice(0, start) + inserted + spacer + after, caret: start + inserted.length + 1 };
}
