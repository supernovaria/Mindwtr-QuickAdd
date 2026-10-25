// Shared text helpers for the capture parser. Several patterns here mirror
// private constants in vendor/mindwtr-core/src/quick-add.ts (v1.3.6); they are
// copied, not imported, because core does not export them. They are only used
// to *locate* tokens core already applied, never to decide what core applies.

/** Characters core's `protectEscapes` treats as escapable with a backslash. */
export const ESCAPE_CHARS = new Set(['@', '#', '+', '/', '!', '%']);

const FOCUS_COMMAND = String.raw`\*(?:\s+focus\b)?`;
const COMMAND_ALTERNATIVES = String.raw`(?:${FOCUS_COMMAND}|link:|note:|start:|due:|review:|project:|area:|energy:|priority:|estimate:|duration:|inbox\b|next\b|in-progress\b|waiting\b|someday\b|reference\b|done\b|archived\b)`;
/** Matches a slash command at the start of the string (core's QUICK_ADD_COMMAND_BOUNDARY body). */
export const COMMAND_AT_START = new RegExp(String.raw`^\/${COMMAND_ALTERNATIVES}`, 'i');

/**
 * Replace every escape sequence core recognises (`\@`, `\#`, ...) with two
 * neutral word characters, keeping the length unchanged. Scanning the masked
 * string means an escaped marker is never mistaken for a token start, while
 * offsets stay valid for the unmasked string.
 */
export function maskEscapes(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\\' && i + 1 < text.length && ESCAPE_CHARS.has(text[i + 1])) {
            out += '__';
            i += 1;
            continue;
        }
        out += text[i];
    }
    return out;
}

/** Undo core-style escapes (`\@` -> `@`). */
export function unescapeText(text: string): string {
    return text.replace(/\\([@#+/!%])/g, '$1');
}

export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSpace(ch: string | undefined): boolean {
    return ch !== undefined && /\s/u.test(ch);
}

export function normalizeName(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * End of a slash command's value, mirroring core's lazy
 * `([\s\S]+?)(?=\s\/<command>|$)`: the first whitespace followed by another
 * slash command, or the end of the text. `skip(i)` lets the caller ignore
 * commands core had already stripped before this one was parsed.
 */
export function commandValueEnd(
    masked: string,
    valueStart: number,
    minLength: number,
    skip: (index: number) => boolean = () => false,
): number {
    for (let j = valueStart + minLength; j < masked.length; j += 1) {
        if (!isSpace(masked[j])) continue;
        if (masked[j + 1] !== '/') continue;
        if (skip(j + 1)) continue;
        if (COMMAND_AT_START.test(masked.slice(j + 1))) return j;
    }
    return masked.length;
}

/** Ranges of claimed text, used to keep highlight spans non-overlapping. */
export class Claims {
    readonly ranges: Array<{ start: number; end: number; kind: string }> = [];

    isClaimed(index: number): boolean {
        return this.ranges.some((r) => index >= r.start && index < r.end);
    }

    overlaps(start: number, end: number): boolean {
        return this.ranges.some((r) => start < r.end && end > r.start);
    }

    /** Claim the parts of [start, end) not already claimed, trimmed of whitespace. */
    addFree(text: string, start: number, end: number, kind: string): void {
        const taken = this.ranges
            .filter((r) => r.start < end && r.end > start)
            .sort((a, b) => a.start - b.start);
        let cursor = start;
        const pieces: Array<[number, number]> = [];
        for (const r of taken) {
            if (r.start > cursor) pieces.push([cursor, r.start]);
            cursor = Math.max(cursor, r.end);
        }
        if (cursor < end) pieces.push([cursor, end]);
        for (let [s, e] of pieces) {
            while (s < e && isSpace(text[s])) s += 1;
            while (e > s && isSpace(text[e - 1])) e -= 1;
            if (e > s) this.ranges.push({ start: s, end: e, kind });
        }
    }
}
