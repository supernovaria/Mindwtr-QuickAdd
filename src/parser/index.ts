// Capture parser: Mindwtr core's parseQuickAdd plus the QuickAdd extensions
// (`!1`..`!4` priority, markdown links, bare `due:`/`review:`), with highlight
// spans for live syntax colouring. See SPEC.md, "Parser contract".

import type { Area, Attachment, Project, Task } from '../../vendor/mindwtr-core/src/types';
import { parseQuickAdd, type QuickAddResult } from '../../vendor/mindwtr-core/src/quick-add';
import { normalizeLinkAttachmentInput } from '../../vendor/mindwtr-core/src/attachment-link-utils';
import { generateUUID } from '../../vendor/mindwtr-core/src/uuid';
import { prepass, toRawRange, type PrepassOptions, type PrepassResult } from './prepass';
import { locateTokens, type Located } from './locate';

export type HighlightKind =
    | 'priority' | 'area' | 'project' | 'context' | 'tag' | 'person'
    | 'date' | 'link' | 'status' | 'energy' | 'estimate' | 'note' | 'focus';

export interface HighlightSpan { start: number; end: number; kind: HighlightKind } // offsets into the raw input

export interface CaptureContext {
    projects: Project[];
    areas: Area[];
    knownContexts?: string[];
    knownTags?: string[];
    now?: Date;
}

export interface CaptureDefaults {      // what the window's controls set
    areaId?: string;
    isFocusedToday?: boolean;            // star button
}

export interface ParsedCapture {
    title: string;                       // cleaned title, tokens stripped
    props: Record<string, unknown>;      // ready for POST /tasks "props" (no id/title)
    highlights: HighlightSpan[];         // non-overlapping, sorted by start
    warnings: string[];                  // e.g. invalid date commands
    /**
     * Set when the line names a project that doesn't exist yet (`+New Project`).
     * It is NOT in `props`: the client must create it (POST /projects with this
     * title and areaId) and put the new id into `props.projectId`, as Mindwtr's
     * own capture does. Ignoring it files the task without a project.
     */
    newProject?: { title: string; areaId?: string };
}

/**
 * Task fields Mindwtr's Local API accepts on create (`sanitize_task_patch_map`
 * in local_api.rs). Anything else makes POST /tasks fail with
 * "Unsupported task field".
 */
const LOCAL_API_TASK_FIELDS = new Set([
    'status', 'tags', 'contexts', 'priority', 'energyLevel', 'taskMode', 'reminderPolicy',
    'textDirection', 'assignedTo', 'description', 'location', 'projectId', 'sectionId', 'areaId',
    'startTime', 'dueDate', 'reviewAt', 'cancelledAt', 'timeEstimate', 'showFutureRecurrence',
    'isFocusedToday', 'suppressMindwtrReminders', 'pushCount', 'timeSpentMinutes',
    'dueReminderLeadMinutes', 'repeatReminderMinutes', 'order', 'orderNum', 'boardOrder',
    'focusOrder', 'checklist', 'attachments', 'relativeStartOffset', 'recurrence', 'viewSectionIds',
]);

interface Attempt {
    pre: PrepassResult;
    result: QuickAddResult;
    located: Located;
    projectApplied: boolean;
}

function isAssignableProject(project: Project | undefined): boolean {
    return Boolean(project && project.status !== 'archived' && !project.deletedAt);
}

function attempt(input: string, ctx: CaptureContext, now: Date, options: PrepassOptions, naturalLanguageDates: boolean): Attempt {
    const pre = prepass(input, options);
    const result = parseQuickAdd(pre.text, ctx.projects, now, ctx.areas, {
        knownContexts: ctx.knownContexts,
        knownTags: ctx.knownTags,
        preserveText: false,
        naturalLanguageDates,
    });
    const projectId = result.props.projectId;
    const projectApplied = projectId
        ? isAssignableProject(ctx.projects.find((p) => p.id === projectId))
        : Boolean(result.projectTitle);
    const located = locateTokens({
        text: pre.text,
        result,
        projects: ctx.projects,
        areas: ctx.areas,
        now,
        projectApplied,
    });
    return { pre, result, located, projectApplied };
}

function normalizeSpans(spans: HighlightSpan[]): HighlightSpan[] {
    const sorted = spans
        .filter((s) => s.end > s.start)
        .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const out: HighlightSpan[] = [];
    let lastEnd = 0;
    for (const span of sorted) {
        const start = Math.max(span.start, lastEnd);
        if (span.end <= start) continue;
        out.push({ start, end: span.end, kind: span.kind });
        lastEnd = span.end;
    }
    return out;
}

export function parseCapture(input: string, ctx: CaptureContext, defaults: CaptureDefaults = {}): ParsedCapture {
    const now = ctx.now ?? new Date();
    const options: PrepassOptions = { bareDue: true, bareReview: true };
    let naturalLanguageDates = true;
    let run = attempt(input, ctx, now, options, naturalLanguageDates);

    // Undo extensions that turned out not to apply, so they read as plain text:
    // a bare `due:`/`review:` whose value isn't a date, and a bare natural
    // date that core found inside a markdown link label.
    for (let pass = 0; pass < 3; pass += 1) {
        const invalid = run.result.invalidDateCommands ?? [];
        let changed = false;
        if (run.pre.bareDue && invalid.some((c) => c.toLowerCase().startsWith('/due:'))) {
            options.bareDue = false;
            changed = true;
        }
        if (run.pre.bareReview && invalid.some((c) => c.toLowerCase().startsWith('/review:'))) {
            options.bareReview = false;
            changed = true;
        }
        const detected = run.located.detectedDateRange;
        if (naturalLanguageDates && detected
            && run.pre.markdownLinks.some((l) => detected[0] < l.textEnd && detected[1] > l.textStart)) {
            naturalLanguageDates = false;
            changed = true;
        }
        if (!changed) break;
        run = attempt(input, ctx, now, options, naturalLanguageDates);
    }

    const { pre, result, located, projectApplied } = run;
    const warnings: string[] = [];
    for (const command of result.invalidDateCommands ?? []) warnings.push(`Invalid date: ${command}`);

    const props: Partial<Task> = { ...result.props };
    let title = result.title;

    // Bare natural-language date, applied only when nothing explicit set one
    // (same rule as core's buildCaptureTaskProps).
    if (result.detectedDate && !props.dueDate) {
        props.dueDate = result.detectedDate.date;
        title = result.detectedDate.titleWithoutDate;
    }

    // Extension: !1..!4 priority. The pre-pass only consumes it when no valid
    // `/priority:` is present, so core never sets a competing value.
    if (pre.priority && !props.priority) props.priority = pre.priority.value;

    // Extension: markdown links become link attachments.
    const createdAt = now.toISOString();
    const markdownAttachments: Attachment[] = [];
    for (const link of pre.markdownLinks) {
        const normalized = normalizeLinkAttachmentInput(`[${link.label}](${link.url})`);
        if (!normalized.uri.trim() || !normalized.title.trim()) continue;
        markdownAttachments.push({
            id: generateUUID(),
            kind: 'link',
            title: normalized.title,
            uri: normalized.uri,
            createdAt,
            updatedAt: createdAt,
        });
    }
    if (markdownAttachments.length > 0) props.attachments = [...(props.attachments ?? []), ...markdownAttachments];

    // Projects: an id the Local API would reject is dropped with a warning; a
    // new project name is handed to the client to create.
    let newProject: ParsedCapture['newProject'];
    if (props.projectId && !projectApplied) {
        warnings.push(`Unknown or archived project: ${props.projectId}`);
        delete props.projectId;
    }
    if (!props.projectId && result.projectTitle) {
        newProject = { title: result.projectTitle };
    }

    // Defaults: what the line sets wins. A project home replaces the area.
    if (props.projectId || newProject) {
        const areaId = props.areaId ?? defaults.areaId;
        delete props.areaId;
        if (newProject && areaId) newProject.areaId = areaId;
    } else if (!props.areaId && defaults.areaId) {
        props.areaId = defaults.areaId;
    }
    if (!props.isFocusedToday && defaults.isFocusedToday) props.isFocusedToday = true;

    const cleanProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || !LOCAL_API_TASK_FIELDS.has(key)) continue;
        cleanProps[key] = value;
    }

    // Highlights: core-located spans mapped back to raw offsets, plus the
    // extension tokens, which are already raw.
    const spans: HighlightSpan[] = [];
    for (const claim of located.claims.ranges) {
        const range = toRawRange(pre.map, claim.start, claim.end);
        if (range) spans.push({ start: range[0], end: range[1], kind: claim.kind as HighlightKind });
    }
    if (located.detectedDateRange) {
        const range = toRawRange(pre.map, located.detectedDateRange[0], located.detectedDateRange[1]);
        if (range) spans.push({ start: range[0], end: range[1], kind: 'date' });
    }
    if (pre.priority && props.priority === pre.priority.value) {
        spans.push({ start: pre.priority.rawStart, end: pre.priority.rawEnd, kind: 'priority' });
    }
    for (const link of pre.markdownLinks) spans.push({ start: link.rawStart, end: link.rawEnd, kind: 'link' });

    return {
        title: title || input.trim(),
        props: cleanProps,
        highlights: normalizeSpans(spans),
        warnings,
        ...(newProject ? { newProject } : {}),
    };
}

const LIST_MARKER_RE = /^[ \t]*(?:[-*•][ \t]+\[[ xX]?\][ \t]+|[-*•][ \t]+|\d+[.)][ \t]+|\[[ xX]?\][ \t]+)/u;

/**
 * One ParsedCapture per non-empty line. `line` is the 0-based line index in
 * `text`, `lineStart` the offset of that line in `text`, `raw` the line as
 * typed (marker included). Highlight offsets are relative to `raw`.
 */
export function parseBulk(text: string, ctx: CaptureContext, defaults?: CaptureDefaults):
    Array<ParsedCapture & { line: number; lineStart: number; raw: string }> {
    const out: Array<ParsedCapture & { line: number; lineStart: number; raw: string }> = [];
    const ctxWithNow = { ...ctx, now: ctx.now ?? new Date() };
    const lineRe = /([^\r\n]*)(\r\n|\r|\n|$)/g;
    let line = 0;
    for (const match of text.matchAll(lineRe)) {
        const raw = match[1];
        const lineStart = match.index ?? 0;
        if (raw.trim()) {
            const marker = LIST_MARKER_RE.exec(raw)?.[0] ?? '';
            const content = raw.slice(marker.length);
            if (content.trim()) {
                const parsed = parseCapture(content, ctxWithNow, defaults);
                out.push({
                    ...parsed,
                    highlights: parsed.highlights.map((h) => ({ ...h, start: h.start + marker.length, end: h.end + marker.length })),
                    line,
                    lineStart,
                    raw,
                });
            }
        }
        line += 1;
        if (match[2] === '') break;
    }
    return out;
}
