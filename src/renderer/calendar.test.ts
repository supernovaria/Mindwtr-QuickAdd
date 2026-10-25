import { describe, expect, test } from 'vitest';
import { addMonths, firstSameWeekday, lastSameWeekday, monthGrid, toIsoDate } from './calendar';

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
