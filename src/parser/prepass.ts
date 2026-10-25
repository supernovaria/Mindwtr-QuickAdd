// Pre-pass for the QuickAdd syntax extensions. Rewrites the raw input into a
// string core's parseQuickAdd understands, and keeps a map from every
// character of the rewritten string back to the raw input so highlight spans
// can point into what the user typed.
//
//   ` !1`..` !4`        removed here; applied as priority after core runs
//   `[label](url)`      replaced by the label (escaped, so it stays plain text)
//   bare `due:`/`review:` get the leading `/` core expects

import type { TaskPriority } from '../../vendor/mindwtr-core/src/types';
import { ESCAPE_CHARS, commandValueEnd, maskEscapes } from './text';

export const SHORTHAND_PRIORITIES: Record<string, TaskPriority> = {
    '1': 'urgent',
    '2': 'high',
    '3': 'medium',
    '4': 'low',
};

export interface PrepassOptions {
    bareDue: boolean;
    bareReview: boolean;
}

export interface MarkdownLink {
    rawStart: number;
    rawEnd: number;
    label: string;
    url: string;
    /** Where the label landed in the rewritten text. */
    textStart: number;
    textEnd: number;
}

export interface PrepassResult {
    text: string;
    /** map[i] = raw index of text[i]; map[text.length] = raw.length. */
    map: number[];
    markdownLinks: MarkdownLink[];
    priority?: { rawStart: number; rawEnd: number; value: TaskPriority };
    bareDue?: { rawStart: number };
    bareReview?: { rawStart: number };
}

type OutChar = [string, number];

interface Edit {
    start: number;
    end: number;
    out: OutChar[];
    order: number;
    onPlaced?: (textStart: number, textEnd: number) => void;
}

const MARKDOWN_LINK_RE = /\[([^[\]\n]+)\]\(\s*((?:https?:\/\/|mailto:|www\.)[^\s()<>]+)\s*\)/gi;
const LINK_COMMAND_RE = /(?:^|\s)(\/link:)/gi;
const PRIORITY_SHORTHAND_RE = /(?:^|\s)(![1-4])(?=\s|$)/g;
const CORE_PRIORITY_RE = /(?:^|\s)\/priority:(?:low|medium|high|urgent)(?=[\s/]|$)/i;

function labelChars(raw: string, start: number, end: number): OutChar[] {
    const out: OutChar[] = [];
    for (let i = start; i < end; i += 1) {
        const ch = raw[i];
        // Escape every marker so core reads the label as literal title text.
        if (ESCAPE_CHARS.has(ch)) out.push(['\\', i]);
        out.push([ch, i]);
    }
    return out;
}

export function prepass(raw: string, options: PrepassOptions): PrepassResult {
    const masked = maskEscapes(raw);
    const edits: Edit[] = [];
    const markdownLinks: MarkdownLink[] = [];
    const mdRanges: Array<[number, number]> = [];
    let order = 0;

    // /link: commands swallow everything up to the next slash command, so a
    // markdown link placed after one would end up inside its URL. Such labels
    // are moved in front of the /link: command instead.
    const linkExtents: Array<{ commandStart: number; valueStart: number; end: number }> = [];
    for (const match of masked.matchAll(LINK_COMMAND_RE)) {
        const commandStart = (match.index ?? 0) + match[0].indexOf('/');
        const valueStart = commandStart + '/link:'.length;
        linkExtents.push({ commandStart, valueStart, end: commandValueEnd(masked, valueStart, 0) });
    }

    for (const match of raw.matchAll(MARKDOWN_LINK_RE)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (start > 0 && raw[start - 1] === '\\') continue;
        // `/link:[label](url)` is core's own syntax; leave it to core.
        if (/\/link:$/i.test(raw.slice(Math.max(0, start - 6), start))) continue;
        const label = match[1];
        if (!label.trim()) continue;
        const labelStart = start + 1;
        const labelEnd = labelStart + label.length;
        const link: MarkdownLink = {
            rawStart: start,
            rawEnd: end,
            label: label.replace(/\s+/g, ' ').trim(),
            url: match[2],
            textStart: 0,
            textEnd: 0,
        };
        const onPlaced = (s: number, e: number) => {
            link.textStart = s;
            link.textEnd = e;
        };
        const extent = linkExtents.find((x) => start > x.valueStart && start < x.end);
        if (extent) {
            edits.push({ start, end, out: [], order: order++ });
            edits.push({
                start: extent.commandStart,
                end: extent.commandStart,
                out: [...labelChars(raw, labelStart, labelEnd), [' ', extent.commandStart]],
                order: order++,
                onPlaced: (s, e) => onPlaced(s, e - 1),
            });
        } else {
            edits.push({ start, end, out: labelChars(raw, labelStart, labelEnd), order: order++, onPlaced });
        }
        markdownLinks.push(link);
        mdRanges.push([start, end]);
    }

    const insideMarkdown = (index: number) => mdRanges.some(([s, e]) => index >= s && index < e);

    let priority: PrepassResult['priority'];
    if (!CORE_PRIORITY_RE.test(masked)) {
        for (const match of masked.matchAll(PRIORITY_SHORTHAND_RE)) {
            const rawStart = (match.index ?? 0) + match[0].indexOf('!');
            if (insideMarkdown(rawStart)) continue;
            priority = { rawStart, rawEnd: rawStart + 2, value: SHORTHAND_PRIORITIES[masked[rawStart + 1]] };
            edits.push({ start: rawStart, end: rawStart + 2, out: [], order: order++ });
            break;
        }
    }

    const bare = (command: 'due' | 'review'): { rawStart: number } | undefined => {
        if (new RegExp(String.raw`(?:^|\s)\/${command}:`, 'i').test(masked)) return undefined;
        const re = new RegExp(String.raw`(?:^|\s)(${command}:)(?=\S)`, 'gi');
        for (const match of masked.matchAll(re)) {
            const rawStart = (match.index ?? 0) + match[0].length - match[1].length;
            if (insideMarkdown(rawStart)) continue;
            edits.push({ start: rawStart, end: rawStart, out: [['/', rawStart]], order: order++ });
            return { rawStart };
        }
        return undefined;
    };
    const bareDue = options.bareDue ? bare('due') : undefined;
    const bareReview = options.bareReview ? bare('review') : undefined;

    // Build the rewritten text and its offset map.
    edits.sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start) || a.order - b.order);
    let text = '';
    const map: number[] = [];
    let pos = 0;
    for (const edit of edits) {
        if (edit.start < pos) continue; // defensive: never apply overlapping edits
        for (; pos < edit.start; pos += 1) {
            text += raw[pos];
            map.push(pos);
        }
        const placedStart = text.length;
        for (const [ch, rawIndex] of edit.out) {
            text += ch;
            map.push(rawIndex);
        }
        edit.onPlaced?.(placedStart, text.length);
        pos = edit.end;
    }
    for (; pos < raw.length; pos += 1) {
        text += raw[pos];
        map.push(pos);
    }
    map.push(raw.length);

    return { text, map, markdownLinks, priority, bareDue, bareReview };
}

/** Map a [start, end) range of the rewritten text back to raw offsets. */
export function toRawRange(map: number[], start: number, end: number): [number, number] | null {
    if (end <= start) return null;
    const rawStart = map[start];
    const rawEnd = map[end - 1] + 1;
    return rawEnd > rawStart ? [rawStart, rawEnd] : null;
}
