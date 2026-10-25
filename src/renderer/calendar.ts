// Date arithmetic for the keyboard date picker. Dates are local calendar days
// (time is always midnight), formatted as YYYY-MM-DD for Mindwtr.
import { getISOWeek } from 'date-fns';

export type WeekStart = 'monday' | 'sunday';

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/** Same day of the month, `delta` months away; clamped (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, delta: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  const day = Math.min(date.getDate(), daysInMonth(first.getFullYear(), first.getMonth()));
  return new Date(first.getFullYear(), first.getMonth(), day);
}

/** The first day of this month that falls on the same weekday. */
export const firstSameWeekday = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), ((date.getDate() - 1) % 7) + 1);

/** The last day of this month that falls on the same weekday. */
export function lastSameWeekday(date: Date): Date {
  const last = daysInMonth(date.getFullYear(), date.getMonth());
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7 * Math.floor((last - date.getDate()) / 7));
}

export const toIsoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** ISO 8601 calendar week of a grid row: the week its Thursday falls in. */
export const rowWeekNumber = (week: Date[], weekStart: WeekStart) => getISOWeek(week[weekStart === 'monday' ? 3 : 4]);

/** Weekday labels in display order. */
export function weekdayLabels(weekStart: WeekStart, locale?: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2026-11-01 is a Sunday.
  const offset = weekStart === 'monday' ? 1 : 0;
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2026, 10, 1 + offset + i)));
}

/** Full weeks covering the month of `date`; days outside the month are included for context. */
export function monthGrid(date: Date, weekStart: WeekStart): Date[][] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const lead = (first.getDay() - (weekStart === 'monday' ? 1 : 0) + 7) % 7;
  const gridStart = addDays(first, -lead);
  const last = daysInMonth(date.getFullYear(), date.getMonth());
  const weeks = Math.ceil((lead + last) / 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)));
}
