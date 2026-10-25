// Stand-in for the Electron preload bridge when the renderer runs in a normal
// browser tab (`npm run dev:web`). Saves just log to the console.
// Add `?mockError=unreachable` (or no-token / unauthorized) to the URL to see
// the "Local API is off" states.
import type { Area, Project } from '../../vendor/mindwtr-core/src/types';
import type { ApiError, ApiResult, QuickAddBridge, Settings, ShowEvent } from '../preload/api';

const now = new Date().toISOString();

const AREAS: Area[] = [
  { id: 'area-work', name: 'Work', color: '#2563eb', order: 0, createdAt: now, updatedAt: now },
  { id: 'area-home', name: 'Home', color: '#16a34a', order: 1, createdAt: now, updatedAt: now },
  { id: 'area-personal', name: 'Personal', color: '#9333ea', order: 2, createdAt: now, updatedAt: now },
  { id: 'area-home-admin', name: 'Home & Admin', color: '#d97706', order: 3, createdAt: now, updatedAt: now },
];

const PROJECTS: Project[] = [
  { id: 'proj-website', title: 'Website relaunch', status: 'active', color: '#2563eb', order: 0, tagIds: [], areaId: 'area-work', createdAt: now, updatedAt: now },
  { id: 'proj-garden', title: 'Garden', status: 'active', color: '#16a34a', order: 1, tagIds: [], areaId: 'area-home', createdAt: now, updatedAt: now },
  { id: 'proj-taxes', title: 'Taxes 2026', status: 'active', color: '#f59e0b', order: 2, tagIds: [], areaId: 'area-personal', createdAt: now, updatedAt: now },
];

const ERROR_MESSAGES: Record<string, ApiError> = {
  unreachable: {
    code: 'unreachable',
    message: 'Mindwtr\'s Local API is off. In Mindwtr, open Settings → Advanced and turn on "Enable local API server", then try again.',
  },
  'no-token': { code: 'no-token', message: 'No Local API token found in Mindwtr\'s config.' },
  unauthorized: { code: 'unauthorized', status: 401, message: 'Mindwtr rejected the API token.' },
};

export function createMockBridge(): QuickAddBridge {
  const mockError = new URLSearchParams(window.location.search).get('mockError');
  const error = mockError ? ERROR_MESSAGES[mockError] ?? ERROR_MESSAGES.unreachable : null;
  const ok = <T,>(data: T): Promise<ApiResult<T>> =>
    Promise.resolve(error ? { ok: false, error } : { ok: true, data });
  let settings: Settings = {
    hotkey: 'Control+Alt+Space',
    apiPort: null,
    apiToken: null,
    startAtLogin: false,
    lastAreaId: '',
    interfaceMode: 'full',
    areaSuggest: { enabled: true, minChars: 1, maxItems: 5 },
    projectSuggest: { enabled: true, minChars: 1, maxItems: 5 },
    datePicker: true,
    weekStart: 'monday',
    tabCompletion: true,
  };
  const showListeners = new Set<(event: ShowEvent) => void>();
  document.documentElement.classList.add('web-mock');

  return {
    isElectron: false,
    listAreas: () => ok(AREAS),
    listProjects: () => ok([...PROJECTS]),
    knownTokens: () => ok({ contexts: ['@phone', '@computer', '@errands'], tags: ['#urgent', '#idea'] }),
    async createTasks(items) {
      console.log('[mock] POST /tasks', items);
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (error) return items.map(() => ({ ok: false, error }));
      for (const item of items) {
        const np = item.newProject;
        if (np && !PROJECTS.some((p) => p.title.toLowerCase() === np.title.toLowerCase())) {
          console.log('[mock] POST /projects', np);
          PROJECTS.push({ id: crypto.randomUUID(), title: np.title, status: 'active', color: '#64748b', order: PROJECTS.length, tagIds: [], areaId: np.areaId, createdAt: now, updatedAt: now });
        }
      }
      return items.map((item) => ({
        ok: true,
        task: { id: crypto.randomUUID(), title: item.title, status: 'inbox', tags: [], contexts: [], createdAt: now, updatedAt: now, ...item.props } as never,
      }));
    },
    importTxt() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.md,text/plain';
        input.onchange = async () => {
          const file = input.files?.[0];
          resolve(file ? { path: file.name, text: await file.text() } : null);
        };
        input.click();
      });
    },
    async saveRecording(data, mimeType) {
      const fileName = `audio-${Date.now()}.webm`;
      console.log('[mock] saveRecording', fileName, data.byteLength, mimeType);
      return { path: `C:\\mock\\recordings\\${fileName}`, fileName, size: data.byteLength, mimeType };
    },
    resize(height) {
      document.documentElement.style.setProperty('--mock-window-height', `${height}px`);
    },
    hide() {
      console.log('[mock] hide window');
      // Simulate the hotkey bringing it back so the page stays usable.
      setTimeout(() => showListeners.forEach((listener) => listener({})), 600);
    },
    async openTask(taskId) {
      console.log('[mock] open in Mindwtr', `mindwtr://open?task=${taskId}`);
      this.hide();
    },
    quit() {
      console.log('[mock] quit');
    },
    async getSettings() {
      return { ...settings };
    },
    async setSettings(patch) {
      settings = { ...settings, ...patch };
      console.log('[mock] settings', settings);
      return { settings: { ...settings } };
    },
    async connectionInfo() {
      return { port: 3456, portSource: 'default', tokenSource: 'none', configDir: null, enabledInConfig: null };
    },
    onShow(callback) {
      showListeners.add(callback);
      return () => showListeners.delete(callback);
    },
  };
}
