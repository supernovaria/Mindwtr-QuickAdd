// Locate the tokens core's parseQuickAdd applied, as ranges of the text core
// was given. Core reports what it applied but not where, so each applied value
// (context, tag, project, date, ...) is searched for in the text, in core's own
// processing order. Earlier claims are skipped by later searches, the same way
// core strips a token before parsing the next kind. Nothing is located unless
// the result shows core applied it.

import type { Area, Project, Task } from '../../vendor/mindwtr-core/src/types';
import { parseQuickAddDateCommands, type QuickAddResult } from '../../vendor/mindwtr-core/src/quick-add';
import { parseTimeEstimateInput } from '../../vendor/mindwtr-core/src/calendar-scheduling';
import { normalizeTaskStatus } from '../../vendor/mindwtr-core/src/task-status';
import {
    COMMAND_AT_START,
    Claims,
    ESCAPE_CHARS,
    commandValueEnd,
    escapeRegExp,
    isSpace,
    maskEscapes,
    normalizeName,
    unescapeText,
} from './text';

export interface LocateInput {
    text: string;
    result: QuickAddResult;
    projects: Project[];
    areas: Area[];
    now: Date;
    /** False when the parsed project was dropped (unknown/archived id). */
    projectApplied: boolean;
}

export interface Located {
    claims: Claims;
    detectedDateRange?: [number, number];
}

type Marker = '@' | '#' | '%' | '!' | '+';

const QUOTE_CLOSERS: Record<string, string> = {
    '"': '"',
    '“': '"“”',
    '”': '"“”',
    '„': '"“”',
    "'": "'",
    '‘': '’',
    '’': '’',
};

function isTokenEnd(text: string, index: number): boolean {
    if (index >= text.length) return true;
    const ch = text[index];
    return isSpace(ch) || !/[\p{L}\p{N}_-]/u.test(ch);
}

function bodyPattern(body: string): RegExp {
    const words = body.trim().split(/\s+/u).filter(Boolean);
    const parts = words.map((word) =>
        Array.from(word)
            .map((ch) => (ESCAPE_CHARS.has(ch) ? `\\\\?${escapeRegExp(ch)}` : escapeRegExp(ch)))
            .join(''),
    );
    return new RegExp(parts.join(String.raw`\s+`), 'iuy');
}

/** Find `<marker>value` or `<marker>"value"` at a word start, outside existing claims. */
function findMarked(
    text: string,
    masked: string,
    claims: Claims,
    marker: Marker,
    value: string,
): [number, number] | null {
    const body = value.startsWith(marker) && (marker === '@' || marker === '#') ? value.slice(1) : value;
    const wanted = normalizeName(body);
    if (!wanted) return null;
    const pattern = bodyPattern(body);
    for (let i = 0; i < masked.length; i += 1) {
        if (masked[i] !== marker) continue;
        if (i > 0 && !isSpace(masked[i - 1])) continue;
        if (claims.isClaimed(i)) continue;

        const opener = text[i + 1];
        const closers = opener ? QUOTE_CLOSERS[opener] : undefined;
        if (closers) {
            let j = i + 2;
            for (; j < text.length; j += 1) {
                if (opener === '"' && text[j] === '\\') {
                    j += 1;
                    continue;
                }
                if (closers.includes(text[j])) break;
            }
            if (j < text.length) {
                const inner = unescapeText(text.slice(i + 2, j).replace(/\\(["\\])/g, '$1'));
                if (normalizeName(inner) === wanted && !claims.overlaps(i, j + 1)) return [i, j + 1];
            }
        }

        pattern.lastIndex = i + 1;
        const match = pattern.exec(text);
        if (match) {
            const end = i + 1 + match[0].length;
            if (isTokenEnd(text, end) && !claims.overlaps(i, end)) return [i, end];
        }
    }
    return null;
}

/** First match of `re` (global) whose slash command is not already claimed. */
function firstFree(masked: string, re: RegExp, claims: Claims): RegExpMatchArray & { start: number } | null {
    for (const match of masked.matchAll(re)) {
        const start = (match.index ?? 0) + match[0].indexOf('/');
        if (claims.isClaimed(start)) continue;
        return Object.assign(match, { start });
    }
    return null;
}

function locateDateCommand(
    text: string,
    masked: string,
    claims: Claims,
    command: 'start' | 'due' | 'review',
    field: 'startTime' | 'dueDate' | 'reviewAt',
    expected: string,
    now: Date,
): void {
    const match = firstFree(masked, new RegExp(String.raw`(?:^|\s)\/${command}:`, 'gi'), claims);
    if (!match) return;
    const valueStart = match.start + command.length + 2;
    const valueEnd = commandValueEnd(masked, valueStart, 1, (i) => claims.isClaimed(i));
    const words = Array.from(text.slice(valueStart, valueEnd).matchAll(/\S+/gu))
        .map((w) => ({ start: valueStart + (w.index ?? 0), end: valueStart + (w.index ?? 0) + w[0].length }))
        .filter((w) => !claims.overlaps(w.start, w.end));
    if (words.length === 0) return;

    // Core tries the whole value, then the longest prefix ending before an
    // inline control (`@ # + ! %` or a slash command). Mirror that order.
    const candidates: number[] = [words.length];
    for (let k = words.length - 1; k >= 1; k -= 1) {
        const next = masked[words[k].start];
        if ('@#+!%'.includes(next) || COMMAND_AT_START.test(masked.slice(words[k].start))) candidates.push(k);
    }
    for (const k of candidates) {
        const value = words.slice(0, k).map((w) => text.slice(w.start, w.end)).join(' ');
        const parsed = parseQuickAddDateCommands(`/${command}:${value}`, now);
        // An empty title means the whole candidate was read as the date (core
        // would otherwise have fallen back to a shorter prefix itself).
        if (parsed.props[field] === expected && parsed.title === '') {
            claims.addFree(text, match.start, words[k - 1].end, 'date');
            return;
        }
    }
    // Core applied a date but no prefix reproduced it: mark the command and its first word.
    claims.addFree(text, match.start, words[0].end, 'date');
}

export function locateTokens(input: LocateInput): Located {
    const { text, result, projects, areas, now } = input;
    const props: Partial<Task> = result.props;
    const masked = maskEscapes(text);
    const claims = new Claims();

    // 1. /link: commands (parsed first, on the untouched text).
    let linkCount = props.attachments?.length ?? 0;
    for (const match of masked.matchAll(/(?:^|\s)\/link:/gi)) {
        if (linkCount <= 0) break;
        const start = (match.index ?? 0) + match[0].indexOf('/');
        const valueStart = start + '/link:'.length;
        const end = commandValueEnd(masked, valueStart, 0);
        if (!text.slice(valueStart, end).trim()) continue;
        claims.addFree(text, start, end, 'link');
        linkCount -= 1;
    }

    // 2-4. contexts, tags, person.
    for (const ctx of props.contexts ?? []) {
        const range = findMarked(text, masked, claims, '@', ctx);
        if (range) claims.addFree(text, range[0], range[1], 'context');
    }
    for (const tag of props.tags ?? []) {
        const range = findMarked(text, masked, claims, '#', tag);
        if (range) claims.addFree(text, range[0], range[1], 'tag');
    }
    if (props.assignedTo) {
        const range = findMarked(text, masked, claims, '%', props.assignedTo);
        if (range) claims.addFree(text, range[0], range[1], 'person');
    }

    // 5. /estimate: and /duration: (every valid one is stripped).
    if (props.timeEstimate) {
        for (const match of masked.matchAll(/(?:^|\s)(\/(?:estimate|duration):)(\S*)/gi)) {
            const start = (match.index ?? 0) + match[0].indexOf('/');
            if (claims.isClaimed(start)) continue;
            const valueStart = start + match[1].length;
            const end = valueStart + match[2].length;
            if (parseTimeEstimateInput(unescapeText(text.slice(valueStart, end))) !== null) {
                claims.addFree(text, start, end, 'estimate');
            }
        }
    }

    // 6-7. /energy: and /priority: (first command only, as in core).
    const simpleCommand = (name: string, expected: string | undefined, kind: string) => {
        if (!expected) return;
        const match = firstFree(masked, new RegExp(String.raw`(?:^|\s)\/${name}:([^\s/]+)`, 'gi'), claims);
        if (!match) return;
        const end = match.start + name.length + 2 + match[1].length;
        if (unescapeText(text.slice(match.start + name.length + 2, end)).toLowerCase() === expected) {
            claims.addFree(text, match.start, end, kind);
        }
    };
    simpleCommand('energy', props.energyLevel, 'energy');
    simpleCommand('priority', props.priority, 'priority');

    // 8. Area: /area:<id|name> wins over !Name in core.
    if (props.areaId) {
        const areaCommand = firstFree(masked, /(?:^|\s)\/area:([^\s/]+)/gi, claims);
        if (areaCommand) {
            claims.addFree(text, areaCommand.start, areaCommand.start + 6 + areaCommand[1].length, 'area');
        } else {
            const name = areas.find((a) => a.id === props.areaId)?.name;
            const range = (name && findMarked(text, masked, claims, '!', name))
                || findMarked(text, masked, claims, '!', props.areaId);
            if (range) claims.addFree(text, range[0], range[1], 'area');
        }
    }

    // 9. /note:
    if (props.description) {
        const match = firstFree(masked, /(?:^|\s)\/note:/gi, claims);
        if (match) {
            const end = commandValueEnd(masked, match.start + 6, 1, (i) => claims.isClaimed(i));
            claims.addFree(text, match.start, end, 'note');
        }
    }

    // 10. Date commands, in core's order.
    if (props.startTime) locateDateCommand(text, masked, claims, 'start', 'startTime', props.startTime, now);
    if (props.dueDate) locateDateCommand(text, masked, claims, 'due', 'dueDate', props.dueDate, now);
    if (props.reviewAt) locateDateCommand(text, masked, claims, 'review', 'reviewAt', props.reviewAt, now);

    // 11. Status token.
    if (props.status) {
        const match = firstFree(
            masked,
            /(?:^|\s)\/(inbox|next|in-progress|waiting|someday|reference|done|archived)(?=\s|$)/gi,
            claims,
        );
        if (match && normalizeTaskStatus(match[1].toLowerCase()) === props.status) {
            claims.addFree(text, match.start, match.start + 1 + match[1].length, 'status');
        }
    }

    // 12. Focus token.
    if (props.isFocusedToday) {
        const match = firstFree(masked, /(?:^|\s)\/\*(?:\s+focus\b)?(?=\s|$)/gi, claims);
        if (match) claims.addFree(text, match.start, match.start + match[0].length - match[0].indexOf('/'), 'focus');
    }

    // 13. Project: /project:<id> wins over +Name in core.
    if (input.projectApplied && (props.projectId || result.projectTitle)) {
        const projectCommand = firstFree(masked, /(?:^|\s)\/project:([^\s/]+)/gi, claims);
        if (projectCommand) {
            claims.addFree(text, projectCommand.start, projectCommand.start + 9 + projectCommand[1].length, 'project');
        } else {
            const name = result.projectTitle
                ?? projects.find((p) => p.id === props.projectId)?.title
                ?? props.projectId;
            const range = name ? findMarked(text, masked, claims, '+', name) : null;
            if (range) claims.addFree(text, range[0], range[1], 'project');
        }
    }

    // 14. Bare natural-language date: the last free occurrence of the matched text.
    let detectedDateRange: [number, number] | undefined;
    const detected = result.detectedDate;
    if (detected && !props.dueDate && detected.matchedText.trim()) {
        const pattern = new RegExp(
            detected.matchedText.trim().split(/\s+/u).map(escapeRegExp).join(String.raw`\s+`),
            'gu',
        );
        const matches = Array.from(text.matchAll(pattern)).reverse();
        for (const match of matches) {
            const start = match.index ?? 0;
            const end = start + match[0].length;
            if (claims.overlaps(start, end)) continue;
            detectedDateRange = [start, end];
            break;
        }
    }

    return { claims, detectedDateRange };
}
