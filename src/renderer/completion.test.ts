import { describe, expect, test } from 'vitest';
import { activeToken, applyCompletion, formatToken, rankSuggestions } from './completion';
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
