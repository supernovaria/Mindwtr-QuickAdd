// QuickAdd's own settings, stored as JSON in Electron's userData folder.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Settings } from '../preload/api';

export const DEFAULT_HOTKEY = 'Control+Alt+Space';

export const DEFAULT_SETTINGS: Settings = {
  hotkey: DEFAULT_HOTKEY,
  apiPort: null,
  apiToken: null,
  startAtLogin: false,
  lastAreaId: '',
};

export function normalizeSettings(raw: unknown): Settings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const port = typeof input.apiPort === 'number' ? Math.trunc(input.apiPort) : null;
  return {
    hotkey: typeof input.hotkey === 'string' && input.hotkey.trim() ? input.hotkey.trim() : DEFAULT_HOTKEY,
    apiPort: port !== null && port >= 1024 && port <= 65535 ? port : null,
    apiToken: typeof input.apiToken === 'string' && input.apiToken.trim() ? input.apiToken.trim() : null,
    startAtLogin: input.startAtLogin === true,
    lastAreaId: typeof input.lastAreaId === 'string' ? input.lastAreaId : '',
  };
}

export class SettingsStore {
  private current: Settings;

  constructor(private readonly file: string) {
    this.current = this.load();
  }

  get(): Settings {
    return { ...this.current };
  }

  set(patch: Partial<Settings>): Settings {
    this.current = normalizeSettings({ ...this.current, ...patch });
    this.save();
    return this.get();
  }

  private load(): Settings {
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.current, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}
