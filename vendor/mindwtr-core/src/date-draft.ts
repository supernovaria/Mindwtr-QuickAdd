import { hasTimeComponent, safeFormatDate, safeParseDate } from './date';

export type DateTimeDraft = {
    date: string;
    time: string;
};

/**
 * Splits a stored ISO/date-only string into the {date, time} pair that backs
 * separate <input type="date"> / <input type="time"> controls. A value with
 * no explicit time component always yields an empty `time` — date-only
 * values never gain an implicit time (see `hasTimeComponent`/`safeParseDueDate`).
 */
export function splitDateTime(iso: string | undefined | null): DateTimeDraft {
    if (!iso) return { date: '', time: '' };
    const parsed = safeParseDate(iso);
    if (!parsed) return { date: '', time: '' };
    return {
        date: safeFormatDate(parsed, 'yyyy-MM-dd'),
        time: hasTimeComponent(iso) ? safeFormatDate(parsed, 'HH:mm') : '',
    };
}

/**
 * Rejoins a {date, time} draft into the stored ISO/date-only string.
 * An empty `date` always yields '' regardless of `time`/`opts.defaultTime` —
 * a date-only value never gains an implicit time on its own.
 */
export function joinDateTime(date: string, time: string, opts?: { defaultTime?: string }): string {
    if (!date) return '';
    if (time) return `${date}T${time}`;
    if (opts?.defaultTime) return `${date}T${opts.defaultTime}`;
    return date;
}
