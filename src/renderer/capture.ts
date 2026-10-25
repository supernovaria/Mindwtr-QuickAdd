// Glue between the UI and the capture parser (src/parser): safe parsing and
// the preview chips shown under the input.
import type { Area, Attachment, Project } from '../../vendor/mindwtr-core/src/types';
import {
  parseBulk,
  parseCapture,
  type CaptureContext,
  type CaptureDefaults,
  type HighlightSpan,
  type ParsedCapture,
} from '../parser';

export type { CaptureContext, CaptureDefaults, HighlightSpan, ParsedCapture };

export type BulkLine = ParsedCapture & { line: number; lineStart: number; raw: string };

function fallback(input: string, error: unknown): ParsedCapture {
  return { title: input.trim(), props: {}, highlights: [], warnings: [`Parser error: ${String(error)}`] };
}

export function safeParse(input: string, ctx: CaptureContext, defaults: CaptureDefaults): ParsedCapture {
  try {
    return parseCapture(input, ctx, defaults);
  } catch (error) {
    console.error(error);
    return fallback(input, error);
  }
}

export function safeParseBulk(text: string, ctx: CaptureContext, defaults: CaptureDefaults): BulkLine[] {
  try {
    return parseBulk(text, ctx, defaults);
  } catch (error) {
    console.error(error);
    let offset = 0;
    return text.split('\n').flatMap((raw, line) => {
      const lineStart = offset;
      offset += raw.length + 1;
      return raw.trim() ? [{ ...fallback(raw, error), line, lineStart, raw }] : [];
    });
  }
}

export interface Chip {
  key: string;
  label?: string;
  value: string;
  tone?: 'warning' | 'accent';
}

const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };

export function formatWhen(value: unknown): string {
  if (typeof value !== 'string' || !value) return String(value ?? '');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const sameYear = date.getFullYear() === today.getFullYear();
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  if (dateOnly || /T00:00(:00(\.000)?)?$/.test(value)) return day;
  return `${day}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function formatMinutes(value: unknown): string {
  if (typeof value === 'number') {
    return value >= 60 ? `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}m` : ''}` : `${value}m`;
  }
  return String(value);
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Chips describing what the parser found (not the title itself). */
export function chipsFor(parsed: ParsedCapture, areas: Area[], projects: Project[]): Chip[] {
  const p = parsed.props;
  const chips: Chip[] = [];
  if (p.dueDate) chips.push({ key: 'due', label: 'Due', value: formatWhen(p.dueDate) });
  if (p.startTime) chips.push({ key: 'start', label: 'Start', value: formatWhen(p.startTime) });
  if (p.reviewAt) chips.push({ key: 'review', label: 'Review', value: formatWhen(p.reviewAt) });
  if (typeof p.priority === 'string') {
    chips.push({ key: 'priority', label: 'Priority', value: PRIORITY_LABEL[p.priority] ?? p.priority });
  }
  if (typeof p.projectId === 'string') {
    const project = projects.find((x) => x.id === p.projectId);
    chips.push({ key: 'project', label: 'Project', value: project?.title ?? p.projectId });
  } else if (parsed.newProject) {
    const area = areas.find((x) => x.id === parsed.newProject?.areaId);
    const name = parsed.newProject.title;
    chips.push({ key: 'project-new', label: 'New project', value: area ? `${name} (${area.name})` : name });
  }
  if (typeof p.areaId === 'string') {
    const area = areas.find((x) => x.id === p.areaId);
    chips.push({ key: 'area', label: 'Area', value: area?.name ?? p.areaId });
  }
  for (const c of asStrings(p.contexts)) chips.push({ key: `ctx:${c}`, value: c });
  for (const t of asStrings(p.tags)) chips.push({ key: `tag:${t}`, value: t });
  if (typeof p.assignedTo === 'string' && p.assignedTo) chips.push({ key: 'person', label: 'Person', value: p.assignedTo });
  if (typeof p.status === 'string' && p.status !== 'inbox') chips.push({ key: 'status', label: 'Status', value: p.status });
  if (typeof p.energyLevel === 'string') chips.push({ key: 'energy', label: 'Energy', value: p.energyLevel });
  if (p.timeEstimate !== undefined && p.timeEstimate !== null) {
    chips.push({ key: 'estimate', label: 'Estimate', value: formatMinutes(p.timeEstimate) });
  }
  if (p.isFocusedToday === true) chips.push({ key: 'focus', value: '★ Today' });
  if (typeof p.description === 'string' && p.description.trim()) {
    chips.push({ key: 'note', label: 'Note', value: p.description.trim().slice(0, 40) });
  }
  const attachments = Array.isArray(p.attachments) ? (p.attachments as Attachment[]) : [];
  for (const a of attachments) {
    if (a && a.kind === 'link') chips.push({ key: `link:${a.id ?? a.uri}`, label: 'Link', value: a.title || a.uri });
  }
  parsed.warnings.forEach((w, i) => chips.push({ key: `warn:${i}`, value: w, tone: 'warning' }));
  return chips;
}

export interface Segment {
  text: string;
  kind?: HighlightSpan['kind'];
}

/** Splits `text` into plain and highlighted runs. Spans must be sorted and non-overlapping. */
export function segment(text: string, spans: HighlightSpan[]): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const span of spans) {
    const start = Math.max(span.start, pos);
    const end = Math.min(span.end, text.length);
    if (end <= start) continue;
    if (start > pos) out.push({ text: text.slice(pos, start) });
    out.push({ text: text.slice(start, end), kind: span.kind });
    pos = end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** Highlights from every bulk line, shifted to offsets in the full text. */
export function bulkHighlights(lines: BulkLine[]): HighlightSpan[] {
  return lines.flatMap((l) => l.highlights.map((h) => ({ ...h, start: h.start + l.lineStart, end: h.end + l.lineStart })));
}
