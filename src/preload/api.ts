// Shared by main, preload and renderer: the shape of `window.quickAdd` and the
// IPC channel names. No Electron or Node imports, so the renderer can use it.
import type { Area, Project, Task } from '../../vendor/mindwtr-core/src/types';

export type ApiErrorCode =
  | 'no-token'      // no token found in Mindwtr's config and none set in Settings
  | 'unreachable'   // connection refused / timed out (Mindwtr closed or Local API off)
  | 'unauthorized'  // 401: token mismatch
  | 'read-only'     // 403: Local API is in read-only mode
  | 'http';         // any other non-2xx

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  status?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** Body of one `POST /tasks`. */
export interface CreateTaskInput {
  title: string;
  props: Record<string, unknown>;
  /**
   * `+Name` that matched no existing project (ParsedCapture.newProject). Main
   * creates it first via `POST /projects` (once per name+area within a batch)
   * and sets `props.projectId` to the new id.
   */
  newProject?: { title: string; areaId?: string };
}

export interface CreateTaskOutcome {
  ok: boolean;
  task?: Task;
  error?: ApiError;
}

export interface KnownTokens {
  contexts: string[];
  tags: string[];
}

export type InterfaceMode = 'full' | 'reduced' | 'minimal';

export interface SuggestSettings {
  enabled: boolean;
  /** Characters after the marker before the list opens (0 = right away). */
  minChars: number;
  /** Most entries shown; null = all. */
  maxItems: number | null;
}

export interface Settings {
  /** Electron accelerator, e.g. "Control+Alt+Space". */
  hotkey: string;
  /** Overrides; null = auto-detect from Mindwtr's config. */
  apiPort: number | null;
  apiToken: string | null;
  startAtLogin: boolean;
  /** Area last chosen in the Area select ("" = no area). */
  lastAreaId: string;
  /**
   * full: everything. reduced: no example line, syntax help toggle is "?".
   * minimal: just the input and preview (Bulk add keeps its buttons).
   */
  interfaceMode: InterfaceMode;
  /** `!Area` suggestions. */
  areaSuggest: SuggestSettings;
  /** `+Project` suggestions. */
  projectSuggest: SuggestSettings;
  /** Calendar after `due:`, `start:` and `review:`. */
  datePicker: boolean;
  weekStart: 'monday' | 'sunday';
  /** Tab completes commands (`d` → `due:`) and cycles on repeat. */
  tabCompletion: boolean;
  /** Offer a URL on the clipboard as a link when the window opens. */
  clipboardLinks: boolean;
}

export interface ConnectionInfo {
  port: number;
  portSource: 'settings' | 'mindwtr-config' | 'default';
  tokenSource: 'settings' | 'mindwtr-config' | 'none';
  /** Directory the Mindwtr config was read from, if any. */
  configDir: string | null;
  /** `local_api_enabled` from Mindwtr's config.toml (null if unknown). */
  enabledInConfig: boolean | null;
}

export interface SavedRecording {
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
}

export type View = 'text' | 'bulk' | 'settings';

export interface ShowEvent {
  view?: View;
  /** Text to load into Bulk add (from tray/menu "Import .txt"). */
  bulkText?: string;
  /** One-off message from main, e.g. the global shortcut could not be registered. */
  notice?: string;
}

export interface SetSettingsResult {
  settings: Settings;
  /** e.g. the hotkey could not be registered. */
  error?: string;
}

export interface QuickAddBridge {
  /** false for the in-browser mock used by `npm run dev:web`. */
  readonly isElectron: boolean;
  listAreas(): Promise<ApiResult<Area[]>>;
  listProjects(): Promise<ApiResult<Project[]>>;
  knownTokens(): Promise<ApiResult<KnownTokens>>;
  createTasks(items: CreateTaskInput[]): Promise<CreateTaskOutcome[]>;
  /** Opens a file picker; null if cancelled. */
  importTxt(): Promise<{ path: string; text: string } | null>;
  saveRecording(data: ArrayBuffer, mimeType: string): Promise<SavedRecording>;
  /** Content height in CSS px; main fits the window to it. */
  resize(height: number): void;
  /** Hides QuickAdd and opens the task in Mindwtr (mindwtr://open?task=<id>). */
  openTask(taskId: string): Promise<void>;
  hide(): void;
  quit(): void;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<SetSettingsResult>;
  connectionInfo(): Promise<ConnectionInfo>;
  /** The clipboard's text if it is a single http(s) URL and clipboardLinks is on; else null. */
  clipboardLink(): Promise<string | null>;
  /** Fired each time the window is shown. Returns an unsubscribe function. */
  onShow(callback: (event: ShowEvent) => void): () => void;
}

export const IPC = {
  listAreas: 'qa:list-areas',
  listProjects: 'qa:list-projects',
  knownTokens: 'qa:known-tokens',
  createTasks: 'qa:create-tasks',
  importTxt: 'qa:import-txt',
  saveRecording: 'qa:save-recording',
  resize: 'qa:resize',
  hide: 'qa:hide',
  quit: 'qa:quit',
  getSettings: 'qa:get-settings',
  setSettings: 'qa:set-settings',
  connectionInfo: 'qa:connection-info',
  openTask: 'qa:open-task',
  clipboardLink: 'qa:clipboard-link',
  shown: 'qa:shown',
} as const;
