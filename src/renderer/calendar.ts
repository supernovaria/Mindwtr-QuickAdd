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

const DAY_MS = 86_400_000;
/** Whole days from `a` to `b` (local calendar days, DST-safe). */
export const daysBetween = (a: Date, b: Date) =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);

const relative = (days: number) =>
  days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days > 0 ? `in ${days} days` : `${-days} days ago`;

const shortWeekday = (date: Date, locale?: string) => date.toLocaleDateString(locale, { weekday: 'short' });

/**
 * "in 5 days" for one date; "starting in 8 days, 4 days total (Mon–Thu)" for a
 * range.
 */
export function describeDates(today: Date, first: Date, last?: Date, locale?: string): string {
  if (!last || sameDay(first, last)) return relative(daysBetween(today, first));
  const startsIn = daysBetween(today, first);
  const starting = startsIn < 0 ? `started ${-startsIn} days ago` : `starting ${relative(startsIn)}`;
  const total = daysBetween(first, last) + 1;
  return `${starting}, ${total} days total (${shortWeekday(first, locale)}–${shortWeekday(last, locale)})`;
}

export interface QuickPick {
  label: string;
  date: Date;
}

/** One-click dates for the calendar's side panel. */
export function quickPicks(today: Date): QuickPick[] {
  const day = today.getDay(); // 0 = Sunday
  const saturday = day === 6 || day === 0 ? today : addDays(today, 6 - day);
  const nextMonday = addDays(today, ((8 - day) % 7) || 7);
  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'This weekend', date: saturday },
    { label: 'Next week', date: nextMonday },
    { label: 'In 2 weeks', date: addDays(today, 14) },
    { label: 'Next month', date: addMonths(today, 1) },
  ];
}
