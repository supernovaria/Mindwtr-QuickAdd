import { describe, expect, test } from 'vitest';
import { applyDate, applyDateRange } from './completion';
import { resolveDateValue, typedDateCommand } from './date-value';
import { toIsoDate } from './calendar';

// A Sunday afternoon.
const NOW = new Date(2026, 9, 25, 15, 30);
const iso = (date: Date | null) => (date ? toIsoDate(date) : null);
const at = (text: string, caret = text.length) => typedDateCommand(text, caret, NOW);

describe('resolveDateValue', () => {
  test('reads values the way Mindwtr does', () => {
    expect(iso(resolveDateValue('due', 'fri', NOW))).toBe('2026-10-30');
    expect(iso(resolveDateValue('due', 'tomorrow 3pm', NOW))).toBe('2026-10-26');
    expect(iso(resolveDateValue('review', '2026-11-03', NOW))).toBe('2026-11-03');
    expect(iso(resolveDateValue('start', 'next mon', NOW))).toBe(iso(resolveDateValue('start', 'next monday', NOW)));
  });
  test('null for text that is not (all) a date', () => {
    expect(resolveDateValue('due', 'fr', NOW)).toBeNull();
    expect(resolveDateValue('due', 'fri buy milk', NOW)).toBeNull();
    expect(resolveDateValue('due', '  ', NOW)).toBeNull();
  });
});

describe('typedDateCommand', () => {
  test('finds the command and resolves its value at the caret', () => {
    const found = at('Call mom due:fri');
    expect(found).toMatchObject({ command: 'due', start: 9, at: 13, end: 16, slash: false, exact: true });
    expect(iso(found!.date)).toBe('2026-10-30');
    expect(at('/review:2026-11-03 x', 18)).toMatchObject({ command: 'review', start: 0, at: 8, end: 18, slash: true, exact: true });
  });
  test('multi-word values, and the caret mid-value', () => {
    expect(at('a start:next mon')).toMatchObject({ command: 'start', at: 8, end: 16, exact: true });
    expect(at('a due:fri x', 6)).toMatchObject({ at: 6, end: 9, exact: true });
    expect(at('a due:tomorrow 3pm', 10)).toMatchObject({ end: 18, exact: true });
  });
  test('a word that does not resolve (yet) still counts, without a date', () => {
    expect(at('a due:fr')).toMatchObject({ at: 6, end: 8, date: null, exact: false });
    // One trailing word may be a time still being typed: the date so far is kept.
    const partial = at('a due:fri bu');
    expect(partial).toMatchObject({ end: 9, exact: false });
    expect(iso(partial!.date)).toBe('2026-10-30');
    // A space after a complete value: still that value.
    expect(at('a due:fri ')).toMatchObject({ end: 9, exact: true });
  });
  test('null once the caret is past the value', () => {
    expect(at('a due:fri buy milk')).toBeNull();
    expect(at('a due:fri @phone')).toBeNull();
    expect(at('a due:fri +Proj')).toBeNull();
    expect(at('a due:fri\nnext')).toBeNull();
    expect(at('a due:x y z w v')).toBeNull();
  });
  test('null for an empty command (that is activeDateCommand) or no command', () => {
    expect(at('a due:')).toBeNull();
    expect(at('a due: fri')).toBeNull();
    expect(at('overdue:fri')).toBeNull();
    expect(at('a du', 4)).toBeNull();
  });
  test('the nearest command before the caret wins', () => {
    expect(at('start:mon due:fri')).toMatchObject({ command: 'due', at: 14 });
    expect(at('start:mon due:fri', 8)).toMatchObject({ command: 'start', at: 6, end: 9 });
  });
});

describe('picking over a typed value', () => {
  test('applyDate replaces the value', () => {
    const text = 'Call mom due:fri @phone';
    const found = typedDateCommand(text, 16, NOW)!;
    expect(applyDate(text, found, '2026-11-06')).toEqual({ text: 'Call mom due:2026-11-06 @phone', caret: 24 });
  });
  test('applyDateRange replaces command and value', () => {
    const text = 'Trip /due:next mon';
    const found = typedDateCommand(text, text.length, NOW)!;
    expect(applyDateRange(text, found, '2026-11-02', '2026-11-06')).toEqual({
      text: 'Trip /start:2026-11-02 /due:2026-11-06 ',
      caret: 39,
    });
  });
  test('a partial value keeps the word after the date', () => {
    const text = 'a due:fri bu';
    expect(applyDate(text, typedDateCommand(text, text.length, NOW)!, '2026-10-30').text).toBe('a due:2026-10-30 bu');
  });
});
