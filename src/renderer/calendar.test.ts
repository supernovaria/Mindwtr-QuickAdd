import { describe, expect, test } from 'vitest';
import { addMonths, daysBetween, describeDates, firstSameWeekday, lastSameWeekday, monthGrid, quickPicks, rowWeekNumber, toIsoDate } from './calendar';

const iso = (d: Date) => toIsoDate(d);

describe('month moves', () => {
  test('keep the day of the month, clamped to short months', () => {
    expect(iso(addMonths(new Date(2026, 9, 25), 1))).toBe('2026-11-25');
    expect(iso(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28');
    expect(iso(addMonths(new Date(2026, 0, 15), -1))).toBe('2025-12-15');
  });
});

describe('first/last week, same weekday', () => {
  // Sun 25 Oct 2026: Sundays in October are 4, 11, 18, 25.
  test('top and bottom of the month', () => {
    expect(iso(firstSameWeekday(new Date(2026, 9, 25)))).toBe('2026-10-04');
    expect(iso(lastSameWeekday(new Date(2026, 9, 25)))).toBe('2026-10-25');
    // Thu 1 Oct 2026 -> last Thursday is the 29th.
    expect(iso(lastSameWeekday(new Date(2026, 9, 1)))).toBe('2026-10-29');
    expect(iso(firstSameWeekday(new Date(2026, 9, 29)))).toBe('2026-10-01');
  });
  test('weekday never changes', () => {
    for (let day = 1; day <= 31; day += 1) {
      const d = new Date(2026, 9, day);
      expect(firstSameWeekday(d).getDay()).toBe(d.getDay());
      expect(lastSameWeekday(d).getDay()).toBe(d.getDay());
      expect(firstSameWeekday(d).getMonth()).toBe(9);
      expect(lastSameWeekday(d).getMonth()).toBe(9);
    }
  });
});

describe('monthGrid', () => {
  test('Monday-start October 2026 opens on Mon 28 Sep and covers whole weeks', () => {
    const grid = monthGrid(new Date(2026, 9, 25), 'monday');
    expect(iso(grid[0][0])).toBe('2026-09-28');
    expect(grid).toHaveLength(5);
    expect(iso(grid[4][6])).toBe('2026-11-01');
  });
  test('Sunday-start', () => {
    const grid = monthGrid(new Date(2026, 9, 25), 'sunday');
    expect(iso(grid[0][0])).toBe('2026-09-27');
    expect(grid[0][0].getDay()).toBe(0);
  });
});

describe('rowWeekNumber', () => {
  test('ISO weeks for October 2026, either week start', () => {
    expect(monthGrid(new Date(2026, 9, 1), 'monday').map((w) => rowWeekNumber(w, 'monday'))).toEqual([40, 41, 42, 43, 44]);
    // Sunday-start rows run Sun–Sat; the row's Thursday decides.
    expect(rowWeekNumber(monthGrid(new Date(2026, 9, 1), 'sunday')[0], 'sunday')).toBe(40);
  });
});

describe('describeDates', () => {
  const today = new Date(2026, 9, 25); // Sun
  test('one date', () => {
    expect(describeDates(today, today)).toBe('today');
    expect(describeDates(today, new Date(2026, 9, 26))).toBe('tomorrow');
    expect(describeDates(today, new Date(2026, 9, 30))).toBe('in 5 days');
    expect(describeDates(today, new Date(2026, 9, 20))).toBe('5 days ago');
  });
  test('a range', () => {
    expect(describeDates(today, new Date(2026, 10, 2), new Date(2026, 10, 5), 'en-US')).toBe('starting in 8 days, 4 days total (Mon–Thu)');
    expect(describeDates(today, today, new Date(2026, 9, 26), 'en-US')).toBe('starting today, 2 days total (Sun–Mon)');
  });
  test('across a DST change (EU clocks go back on 25 Oct 2026)', () => {
    expect(daysBetween(new Date(2026, 9, 24), new Date(2026, 9, 26))).toBe(2);
  });
});

describe('quickPicks', () => {
  const picks = (d: Date) => Object.fromEntries(quickPicks(d).map((p) => [p.label, toIsoDate(p.date)]));
  test('from a Sunday', () => {
    expect(picks(new Date(2026, 9, 25))).toEqual({
      Today: '2026-10-25', Tomorrow: '2026-10-26', 'This weekend': '2026-10-25',
      'Next week': '2026-10-26', 'In 2 weeks': '2026-11-08', 'Next month': '2026-11-25',
    });
  });
  test('from a Wednesday', () => {
    const p = picks(new Date(2026, 9, 21));
    expect(p['This weekend']).toBe('2026-10-24');
    expect(p['Next week']).toBe('2026-10-26');
  });
});
