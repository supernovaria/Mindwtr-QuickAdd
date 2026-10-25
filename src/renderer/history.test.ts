import { describe, expect, test } from 'vitest';
import { HISTORY_LIMIT, historyStep, loadHistory, rememberEntry, saveHistory } from './history';

const ENTRIES = ['newest @phone', 'middle', 'oldest'];

describe('rememberEntry', () => {
  test('adds at the front and moves a repeat there instead of duplicating it', () => {
    expect(rememberEntry(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(rememberEntry(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });
  test('keeps the raw text, skips blanks, caps the length', () => {
    expect(rememberEntry([], 'Call mom due:2026-11-03 @phone')).toEqual(['Call mom due:2026-11-03 @phone']);
    expect(rememberEntry(['a'], '   ')).toEqual(['a']);
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => `t${i}`);
    const next = rememberEntry(full, 'new');
    expect(next).toHaveLength(HISTORY_LIMIT);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`t${HISTORY_LIMIT - 1}`);
  });
});

describe('historyStep', () => {
  test('↑ from an empty field recalls the newest, then older ones', () => {
    expect(historyStep(ENTRIES, null, '', 'older')).toEqual({ index: 0, text: 'newest @phone' });
    expect(historyStep(ENTRIES, 0, 'newest @phone', 'older')).toEqual({ index: 1, text: 'middle' });
    expect(historyStep(ENTRIES, 1, 'middle', 'older')).toEqual({ index: 2, text: 'oldest' });
  });
  test('↑ stops at the oldest entry', () => {
    expect(historyStep(ENTRIES, 2, 'oldest', 'older')).toBeNull();
  });
  test('↓ goes newer, then back to empty', () => {
    expect(historyStep(ENTRIES, 2, 'oldest', 'newer')).toEqual({ index: 1, text: 'middle' });
    expect(historyStep(ENTRIES, 0, 'newest @phone', 'newer')).toEqual({ index: null, text: '' });
    expect(historyStep(ENTRIES, null, '', 'newer')).toBeNull();
  });
  test('typed or edited text keeps the arrows for the caret', () => {
    expect(historyStep(ENTRIES, null, 'Call', 'older')).toBeNull();
    expect(historyStep(ENTRIES, 1, 'middle edited', 'older')).toBeNull();
    expect(historyStep(ENTRIES, 1, 'middle edited', 'newer')).toBeNull();
    // An edited entry cleared again starts over from the newest.
    expect(historyStep(ENTRIES, 1, '', 'older')).toEqual({ index: 0, text: 'newest @phone' });
  });
  test('no history, nothing to recall', () => {
    expect(historyStep([], null, '', 'older')).toBeNull();
  });
});

describe('storage', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  test('round-trips', () => {
    const store = memory();
    saveHistory(['b', 'a'], store);
    expect(loadHistory(store)).toEqual(['b', 'a']);
  });
  test('garbled or failing storage reads as empty and never throws', () => {
    expect(loadHistory({ getItem: () => '{not json' })).toEqual([]);
    expect(loadHistory({ getItem: () => '[1, "x", null]' })).toEqual(['x']);
    expect(loadHistory({ getItem: () => { throw new Error('blocked'); } })).toEqual([]);
    expect(() => saveHistory(['a'], { setItem: () => { throw new Error('full'); } })).not.toThrow();
  });
});
