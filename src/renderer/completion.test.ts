import { describe, expect, test } from 'vitest';
import { activeDateCommand, activeToken, applyCompletion, applyDate, applyDateRange, cycleDateCommand, formatToken, rankSuggestions, tabCompletion } from './completion';
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
    expect(activeDateCommand('Call mom due:', 13)).toEqual({ command: 'due', at: 13, start: 9, slash: false });
    expect(activeDateCommand('/start:', 7)).toEqual({ command: 'start', at: 7, start: 0, slash: true });
    expect(activeDateCommand('x review:', 9)).toEqual({ command: 'review', at: 9, start: 2, slash: false });
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

describe('tabCompletion', () => {
  const opts = (text: string) => tabCompletion(text, text.length)?.options;
  test('one letter completes to commands, dates bare', () => {
    expect(opts('Call mom d')).toEqual(['due:', '/duration:', '/done']);
    expect(opts('s')).toEqual(['start:', '/someday']);
    expect(opts('r')).toEqual(['review:', '/reference']);
  });
  test('a typed slash keeps the slash form', () => {
    expect(opts('x /d')).toEqual(['/due:', '/duration:', '/done']);
    expect(opts('/n')).toEqual(['/note:', '/next']);
  });
  test('values for /priority: and /energy:', () => {
    expect(opts('Fix /priority:')).toEqual(['/priority:urgent', '/priority:high', '/priority:medium', '/priority:low']);
    expect(opts('energy:h')).toEqual(['energy:high']);
  });
  test('reports where the word starts', () => {
    expect(tabCompletion('Call mom d', 10)?.start).toBe(9);
  });
  test('nothing to complete', () => {
    expect(tabCompletion('Call mom', 8)?.options).toEqual(undefined);
    expect(opts('Call x')).toBeUndefined();
    expect(opts('Call ')).toBeUndefined();
    expect(opts('!ho')).toBeUndefined();
    expect(tabCompletion('dx', 1)).toBeNull(); // caret inside a word
    expect(tabCompletion('d x', 1)?.options[0]).toBe('due:'); // end of a word mid-line is fine
  });
  test('every option parses as a command once given a value', () => {
    expect(parseCapture(`Ship ${opts('d')![0]}2026-11-03`, { areas: [], projects: [] }).props.dueDate).toBe('2026-11-03');
    expect(parseCapture(`Ship ${opts('/n')![1]}`, { areas: [], projects: [] }).props.status).toBe('next');
    expect(parseCapture(`Ship ${opts('/priority:u')![0]}`, { areas: [], projects: [] }).props.priority).toBe('urgent');
  });
});

describe('applyDateRange', () => {
  test('turns the command into start: and due:', () => {
    const text = 'Trip due: @travel';
    const result = applyDateRange(text, activeDateCommand(text, 9)!, '2026-11-02', '2026-11-06');
    expect(result.text).toBe('Trip start:2026-11-02 due:2026-11-06 @travel');
    const parsed = parseCapture(result.text, { areas: [], projects: [] });
    expect(parsed.props).toMatchObject({ startTime: '2026-11-02', dueDate: '2026-11-06' });
    expect(parsed.title).toBe('Trip');
  });
  test('keeps a typed slash', () => {
    const text = 'Trip /start:';
    expect(applyDateRange(text, activeDateCommand(text, text.length)!, '2026-11-02', '2026-11-06').text)
      .toBe('Trip /start:2026-11-02 /due:2026-11-06 ');
  });
});

describe('cycleDateCommand', () => {
  test('start -> due -> review -> start, keeping the slash and the caret after the colon', () => {
    const step = (text: string) => cycleDateCommand(text, activeDateCommand(text, text.length)!);
    expect(step('Trip due:')).toEqual({ text: 'Trip review:', caret: 12 });
    expect(step('Trip review:').text).toBe('Trip start:');
    expect(step('Trip /start:').text).toBe('Trip /due:');
  });
});
