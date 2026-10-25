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
  /** Where the command word starts (its slash, if typed). */
  start: number;
  slash: boolean;
  /** End of a value already typed after the colon, which a pick replaces (see date-value.ts). */
  end?: number;
}

/** A `start:`/`due:`/`review:` command (slash optional) with nothing typed after it yet. */
export function activeDateCommand(text: string, caret: number): ActiveDateCommand | null {
  const match = text.slice(0, caret).match(/(?:^|\s)(\/?)(start|due|review):$/i);
  if (!match) return null;
  if (/^\S/.test(text.slice(caret))) return null;
  const word = match[1] + match[2] + ':';
  return { command: match[2].toLowerCase() as DateCommand, at: caret, start: caret - word.length, slash: match[1] === '/' };
}

/** Inserts the picked date (YYYY-MM-DD) at the command, or over its typed value, and moves the caret past a space. */
export function applyDate(text: string, command: ActiveDateCommand, isoDate: string): { text: string; caret: number } {
  return replaceRange(text, command.at, command.end ?? command.at, isoDate);
}

const NEXT_DATE_COMMAND: Record<DateCommand, DateCommand> = { start: 'due', due: 'review', review: 'start' };

/** Swaps the empty command for the next of start → due → review, keeping a typed slash. */
export function cycleDateCommand(text: string, command: ActiveDateCommand): { text: string; caret: number } {
  const word = `${command.slash ? '/' : ''}${NEXT_DATE_COMMAND[command.command]}:`;
  return { text: text.slice(0, command.start) + word + text.slice(command.at), caret: command.start + word.length };
}

/** Replaces the command with `start:<first> due:<last>` (keeping a typed slash). */
export function applyDateRange(text: string, command: ActiveDateCommand, startIso: string, dueIso: string): { text: string; caret: number } {
  const slash = command.slash ? '/' : '';
  return replaceRange(text, command.start, command.end ?? command.at, `${slash}start:${startIso} ${slash}due:${dueIso}`);
}

// ---- Tab completion of commands, shell style ------------------------------------

/**
 * Every command Mindwtr's quick-add parser understands, dates first. `:`
 * commands take a value. start/due/review also work without the slash, so they
 * complete bare unless a slash was typed.
 */
const COMMANDS = [
  'due:', 'start:', 'review:',
  'priority:', 'energy:', 'estimate:', 'duration:', 'note:', 'link:', 'project:', 'area:',
  'next', 'inbox', 'waiting', 'someday', 'reference', 'in-progress', 'done', 'archived',
];
const BARE_COMMANDS = new Set(['due:', 'start:', 'review:']);
const COMMAND_VALUES: Record<string, string[]> = {
  priority: ['urgent', 'high', 'medium', 'low'],
  energy: ['low', 'medium', 'high'],
};

export interface TabCompletion {
  /** Start of the word being completed. */
  start: number;
  /** Replacements for the word, in cycling order. */
  options: string[];
}

/**
 * What Tab can turn the word ending at the caret into: a command (`d` → `due:`,
 * `/n` → `/next`, `/note:`), or a command value (`/priority:h` → `/priority:high`).
 * Null when nothing matches, so Tab keeps its usual meaning.
 */
export function tabCompletion(text: string, caret: number): TabCompletion | null {
  if (/^\S/.test(text.slice(caret))) return null;
  const word = text.slice(0, caret).match(/(?:^|\s)(\S+)$/)?.[1];
  if (!word) return null;
  const start = caret - word.length;

  const valueMatch = word.match(/^(\/?)(priority|energy):([a-z]*)$/i);
  if (valueMatch) {
    const [, slash, command, typed] = valueMatch;
    const options = COMMAND_VALUES[command.toLowerCase()]
      .filter((value) => value.startsWith(typed.toLowerCase()))
      .map((value) => `${slash}${command}:${value}`);
    return options.length > 0 ? { start, options } : null;
  }

  const commandMatch = word.match(/^(\/?)([a-z-]*)$/i);
  if (!commandMatch) return null;
  const [, slash, typed] = commandMatch;
  if (!slash && !typed) return null;
  const matches = COMMANDS.filter((command) => command.startsWith(typed.toLowerCase()));
  // A date command opens the calendar, where Tab picks a date instead of
  // cycling on. Put it second so Tab, Tab lands on it (`d` → `/duration:` →
  // `due:`) and a third Tab picks today.
  const dateIndex = matches.findIndex((command) => BARE_COMMANDS.has(command));
  if (dateIndex > 1 || (dateIndex === 0 && matches.length > 1)) {
    const [dateCommand] = matches.splice(dateIndex, 1);
    matches.splice(1, 0, dateCommand);
  }
  const options = matches.map((command) => (slash || !BARE_COMMANDS.has(command) ? `/${command}` : command));
  return options.length > 0 ? { start, options } : null;
}

function replaceRange(text: string, start: number, end: number, inserted: string): { text: string; caret: number } {
  const after = text.slice(end);
  const spacer = after.startsWith(' ') ? '' : ' ';
  return { text: text.slice(0, start) + inserted + spacer + after, caret: start + inserted.length + 1 };
}
