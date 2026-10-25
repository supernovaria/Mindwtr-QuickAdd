import { describe, expect, test } from 'vitest';
import { activeDateCommand, activeToken, applyCompletion, applyDate, formatToken, rankSuggestions } from './completion';
import { parseCapture } from '../parser';

const AREAS = ['Career & Impact', 'Social', 'Health, Self & Well-being', 'Home & Admin', 'Transition', 'Discovery & Exploration'];

describe('activeToken', () => {
  test('opens once a letter follows the marker', () => {
    expect(activeToken('Fix sink !', 10, '!')).toBeNull();
    expect(activeToken('Fix sink !h', 11, '!')).toEqual({ marker: '!', query: 'h', start: 9, end: 11 });
  });
  test('ignores priority digits and mid-word markers', () => {
    expect(activeToken('Fix !1', 6, '!')).toBeNull();
    expect(activeToken('Wow!h', 5, '!')).toBeNull();
  });
  test('closes after a space', () => {
    expect(activeToken('!home x', 7, '!')).toBeNull();
  });
  test('covers the rest of the word when the caret is mid-word', () => {
    expect(activeToken('a !hom b', 5, '!')).toEqual({ marker: '!', query: 'ho', start: 2, end: 6 });
  });
});

describe('rankSuggestions', () => {
  test('prefix, then word start, then substring', () => {
    expect(rankSuggestions(AREAS, 'ex')).toEqual(['Discovery & Exploration']);
    expect(rankSuggestions(AREAS, 'h')).toEqual(['Health, Self & Well-being', 'Home & Admin']);
    expect(rankSuggestions(AREAS, 'ad')).toEqual(['Home & Admin']);
    // "Impact" starts a word; the rest only contain an "i", so they keep their order.
    expect(rankSuggestions(AREAS, 'i')).toEqual(['Career & Impact', 'Social', 'Health, Self & Well-being', 'Home & Admin', 'Transition']);
  });
  test('caps at five', () => {
    expect(rankSuggestions(AREAS, 'a')).toHaveLength(5);
  });
});

describe('applyCompletion', () => {
  test('quotes multi-word names and adds a space', () => {
    const text = 'Fix sink !ho';
    const result = applyCompletion(text, activeToken(text, text.length, '!')!, 'Home & Admin');
    expect(result.text).toBe('Fix sink !"Home & Admin" ');
    expect(result.caret).toBe(result.text.length);
  });
  test('keeps single words bare and reuses an existing space', () => {
    const text = '!so call Sam';
    const result = applyCompletion(text, activeToken(text, 3, '!')!, 'Social');
    expect(result.text).toBe('!Social call Sam');
    expect(result.caret).toBe(8);
  });
  test('Mindwtr parses the inserted token as the area', () => {
    const areas = AREAS.map((name, i) => ({ id: `a${i}`, name }));
    for (const name of AREAS) {
      const input = `Do thing ${formatToken('!', name)}`;
      const parsed = parseCapture(input, { areas: areas as never, projects: [] });
      expect(parsed.props.areaId, name).toBe(areas.find((a) => a.name === name)!.id);
      expect(parsed.title).toBe('Do thing');
      expect(parsed.highlights.some((h) => h.kind === 'area' && input.slice(h.start, h.end) === formatToken('!', name))).toBe(true);
    }
  });
});

describe('trigger thresholds and limits', () => {
  test('minChars 0 opens right after the marker; digits still never open', () => {
    expect(activeToken('Fix !', 5, '!', 0)).toEqual({ marker: '!', query: '', start: 4, end: 5 });
    expect(activeToken('Fix !1', 6, '!', 0)).toBeNull();
  });
  test('minChars 3 waits for three characters', () => {
    expect(activeToken('a +we', 5, '+', 3)).toBeNull();
    expect(activeToken('a +web', 6, '+', 3)?.query).toBe('web');
  });
  test('empty query lists everything; null max means no limit', () => {
    expect(rankSuggestions(AREAS, '', null)).toEqual(AREAS);
    expect(rankSuggestions(AREAS, '', 2)).toEqual(AREAS.slice(0, 2));
  });
  test('+Project completes and parses as the project', () => {
    const text = 'Draft copy +web';
    const result = applyCompletion(text, activeToken(text, text.length, '+')!, 'Website Relaunch');
    expect(result.text).toBe('Draft copy +"Website Relaunch" ');
    const parsed = parseCapture(result.text, { areas: [], projects: [{ id: 'p9', title: 'Website Relaunch', status: 'active' } as never] });
    expect(parsed.props.projectId).toBe('p9');
  });
});

describe('date commands', () => {
  test('open right after the colon, slash optional', () => {
    expect(activeDateCommand('Call mom due:', 13)).toEqual({ command: 'due', at: 13 });
    expect(activeDateCommand('/start:', 7)).toEqual({ command: 'start', at: 7 });
    expect(activeDateCommand('x review:', 9)).toEqual({ command: 'review', at: 9 });
  });
  test('close once something is typed or the word is not a command', () => {
    expect(activeDateCommand('due:t', 5)).toBeNull();
    expect(activeDateCommand('overdue:', 8)).toBeNull();
    expect(activeDateCommand('due:x', 4)).toBeNull();
  });
  test('insert the ISO date and a space', () => {
    const text = 'Call mom due: @phone';
    const result = applyDate(text, activeDateCommand(text, 13)!, '2026-10-30');
    expect(result.text).toBe('Call mom due:2026-10-30 @phone');
    expect(result.caret).toBe(24);
  });
});
