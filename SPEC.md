# Mindwtr QuickAdd — spec

A standalone Electron quick-capture window for Mindwtr (Windows). It creates tasks
in the user's running Mindwtr desktop app (Microsoft Store build, v1.3.6) through
Mindwtr's **Local API**, and parses input with Mindwtr's own quick-add parser so
syntax behaves identically. Parser and UI changes are written so they can later be
offered upstream to https://github.com/dongdongbh/Mindwtr (AGPL-3.0; this project
is AGPL-3.0 too).

## Layout

```
vendor/mindwtr-core/              Mindwtr packages/core @ v1.3.6 (read-only; do not edit)
vendor/mindwtr-desktop-reference/ Mindwtr's QuickAddModal etc. @ v1.3.6 (reference only)
src/parser/                       capture parser: wraps core parseQuickAdd + extensions
src/main/                         Electron main process (window, tray, hotkey, Local API client)
src/preload/                      contextBridge API exposed to the renderer
src/renderer/                     React UI
```

Import core modules by path (e.g. `vendor/mindwtr-core/src/quick-add.ts`), not via
its barrel `index.ts`, to keep the bundle small.

## Parser contract (`src/parser/index.ts`)

```ts
import type { Area, Project, Task } from '../../vendor/mindwtr-core/src/types';

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
}

export function parseCapture(input: string, ctx: CaptureContext, defaults?: CaptureDefaults): ParsedCapture;

// One ParsedCapture per non-empty line. Leading list markers ("- ", "* ", "• ",
// "1. ", "1) ", "[ ] ", "- [ ] ") are stripped first. Highlight offsets are relative to
// each line's raw text (including the marker), plus `lineStart` into the full text.
export function parseBulk(text: string, ctx: CaptureContext, defaults?: CaptureDefaults):
  Array<ParsedCapture & { line: number; lineStart: number; raw: string }>;
```

### Behaviour

- Everything core's `parseQuickAdd` understands keeps working: `@context`, `#tag`,
  `+Project`, `!Area`, `%Person`, `/due:`, `/start:`, `/review:`, `/link:`, `/note:`,
  `/priority:`, `/energy:`, `/estimate:`, status commands, natural-language dates.
- **New: ` !1`..` !4` = priority** urgent / high / medium / low. Matches only `!`
  + a single digit 1–4 at the start or after whitespace, followed by whitespace or end.
  `!Work` (and `!12`, `!5`) still mean an area as before, so handle this before core
  parses `!Area`.
- **New: markdown links** `[label](https://…)` become a link attachment
  (`kind: 'link'`, title = label, uri = url, plus id/createdAt/updatedAt), and the label
  stays in the title as plain text. Keep any existing core `/link:` behaviour.
- **New: bare `due:` and `review:`** (no leading slash) work like `/due:` and
  `/review:`, including natural-language values (`due:tomorrow`, `review:next friday`).
  Only at the start or after whitespace (so `overdue:` and URLs don't match).
- Defaults: what a line sets itself wins. Otherwise `defaults.areaId` applies (unless
  the line sets a project, because the project already implies an area) and `defaults.isFocusedToday`.
- `props` must contain only fields Mindwtr's Local API accepts on create (see
  `create_task_from_body` / `sanitize_task_patch_map` in Mindwtr's `local_api.rs`):
  status, priority, tags, contexts, dueDate, startTime, reviewAt, projectId, areaId,
  description, assignedTo, energyLevel, timeEstimate, isFocusedToday, attachments, etc.
- Highlights cover every recognized token, extensions included, using offsets
  into the raw input string.

## Local API (Mindwtr desktop, Rust `local_api.rs`)

- Opt-in: Mindwtr Settings → Local API. Binds 127.0.0.1:<port>, `Authorization: Bearer <token>`.
- Config lives in `config.toml` (`local_api_enabled`, `local_api_port`, `local_api_token`;
  the token may be in `secrets.toml`) under
  `%LOCALAPPDATA%\Packages\DongdaLi.Mindwtr_*\LocalCache\Roaming\mindwtr\config\`
  (Store build) or `%APPDATA%\mindwtr\config\` (non-Store build).
- Routes used: `GET /health`, `GET /areas`, `GET /projects`, `GET /tasks?all=1` (for
  known contexts/tags), `POST /tasks` with body `{ "title": string, "props": {...} }` → 201 `{ task }`.
- No CORS headers, so all HTTP goes through the Electron main process.
- There is no endpoint for creating areas, so the app doesn't create them.

## UI (see the user's annotated screenshot of Mindwtr's current modal)

- Frameless, transparent Electron window. The card has **rounded corners (~12px) and a
  thin 1px blue hairline border** in the accent colour. Light/dark follows the OS.
- **Title bar:** "Add Task" · **Text/Audio segmented toggle right next to the title** ·
  spacer · **"…" menu button** · "Esc" hint. The bar is the drag region.
- **"…" menu:** Import .txt, Bulk add, Settings, Quit.
- **Body:** input with ☆ focus-today star · Area select · hint "e.g. Call mom /due:tomorrow @phone"
  · then **one row** with "Quick Add syntax help" disclosure on the left and **Cancel / Save
  on the right**. No empty space below. The window height fits the content (auto-resize).
- **Live highlighting:** recognized tokens are tinted in the accent colour as you type
  (mirror/backdrop technique behind a transparent textarea, same font metrics).
  Under the input, show a compact preview of the parsed result (chips: due date, priority,
  area, project, contexts, tags, links).
- **Bulk add:** multi-line textarea, each line highlighted the same way, a "N tasks" count,
  per-line preview. Ctrl+Enter saves all. **Import .txt** opens a file picker and loads
  the file into Bulk add.
- **Keys:** Enter saves (text mode), Ctrl+Enter saves (bulk), Esc hides the window.
- **Global hotkey** toggles the window (default `Ctrl+Alt+Space`, configurable). Tray icon,
  single instance, optional start-at-login. After saving: brief "Added" confirmation, reset, hide.
- **Settings:** hotkey, API port/token override (auto-detected by default), start at login.
  Stored as JSON in Electron `userData`.
- **Errors:** if the Local API is off or unreachable, show a clear inline message telling the
  user how to enable it, and keep the typed text.
