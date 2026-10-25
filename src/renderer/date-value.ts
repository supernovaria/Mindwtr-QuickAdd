// The date command whose value is being typed at the caret (`due:fri`,
// `/review:2026-11-03`, `start:next mon`), resolved the way Mindwtr's quick-add
// parser reads it, so the calendar can show which day that is.
import { parseQuickAddDateCommands } from '../../vendor/mindwtr-core/src/quick-add';
import { startOfDay } from './calendar';
import type { ActiveDateCommand, DateCommand } from './completion';

/** Most words read as one date (as in the parser's prepass). */
const MAX_DATE_WORDS = 4;
const FIELD = { start: 'startTime', due: 'dueDate', review: 'reviewAt' } as const;

export interface TypedDateCommand extends ActiveDateCommand {
  /** Where the value starts, right after the colon (same as `at`). */
  at: number;
  /** End of the span a pick replaces: the resolved words, or all typed ones. */
  end: number;
  /** The day the value resolves to; null while nothing typed so far does. */
  date: Date | null;
  /** True when every word typed up to the caret is part of the date. */
  exact: boolean;
}

/** The local day core resolves `<command>:<value>` to, or null if it isn't a date. */
export function resolveDateValue(command: DateCommand, value: string, now: Date): Date | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = parseQuickAddDateCommands(`/${command}:${text}`, now);
  const raw = parsed.props[FIELD[command]];
  // A leftover title means core only read part of the value as the date.
  if (typeof raw !== 'string' || parsed.title !== '') return null;
  const day = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const date = new Date(raw); // with a time: an ISO timestamp in UTC
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

const COMMAND_RE = /(?:^|\s)(\/?)(start|due|review):(?=\S)/gi;
/** A word that starts something else: a token, another command, a link. */
const OTHER_TOKEN_RE = /^(?:[/@#+!%*[]|(?:start|due|review):)/i;

/**
 * The date command whose (non-empty) value the caret is in, with the date it
 * resolves to: the longest run of words after the colon that core reads as one
 * date. The value ends at another token, a line break or MAX_DATE_WORDS. The
 * caret may sit one word past the date (a time still being typed, say); any
 * further and it is in the title, so the result is null.
 */
export function typedDateCommand(text: string, caret: number, now: Date): TypedDateCommand | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = text.indexOf('\n', caret) < 0 ? text.length : text.indexOf('\n', caret);
  const wordEnd = caret + (text.slice(caret).match(/^\S*/)?.[0].length ?? 0);
  let match: RegExpExecArray | null = null;
  for (const m of text.slice(lineStart, wordEnd).matchAll(COMMAND_RE)) {
    if (lineStart + (m.index ?? 0) + m[0].length <= caret) match = m;
  }
  if (!match) return null;
  const at = lineStart + (match.index ?? 0) + match[0].length;
  const start = at - match[1].length - match[2].length - 1;

  const words: { start: number; end: number }[] = [];
  for (const w of text.slice(at, lineEnd).matchAll(/\S+/g)) {
    if (words.length === MAX_DATE_WORDS || (words.length > 0 && OTHER_TOKEN_RE.test(w[0]))) break;
    words.push({ start: at + (w.index ?? 0), end: at + (w.index ?? 0) + w[0].length });
  }
  // The word the caret is in, or the one before the space it follows; null when
  // the caret is past where the value stopped (another token, too many words).
  let caretWord = -1;
  while (caretWord + 1 < words.length && words[caretWord + 1].start <= caret) caretWord += 1;
  if (caretWord < 0) return null;
  if (caretWord === words.length - 1 && /\S/.test(text.slice(words[caretWord].end, caret))) return null;

  const command = match[2].toLowerCase() as DateCommand;
  const base = { command, at, start, slash: match[1] === '/' };
  for (let k = words.length; k >= 1; k -= 1) {
    const date = resolveDateValue(command, text.slice(at, words[k - 1].end), now);
    if (!date) continue;
    if (caretWord > k) return null;
    return { ...base, end: words[k - 1].end, date, exact: caretWord < k };
  }
  return { ...base, end: words[caretWord].end, date: null, exact: false };
}
