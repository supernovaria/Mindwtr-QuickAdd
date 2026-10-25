// Electron main process: the capture window, tray, global hotkey and the IPC
// surface behind `window.quickAdd` (see src/preload/api.ts).
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, type CreateTaskInput, type Settings, type ShowEvent } from '../preload/api';
import { drawIconBgra } from './icon';
import { LocalApiClient } from './local-api-client';
import { SettingsStore } from './settings';

const WINDOW_WIDTH = 580;
const MIN_HEIGHT = 120;
const isDev = !!process.env.VITE_DEV_SERVER_URL;
const selfTest = process.env.QUICKADD_SELFTEST === '1';
const keepOnBlur = selfTest || process.env.QUICKADD_KEEP_ON_BLUR === '1';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: SettingsStore;
let api: LocalApiClient;
let isQuitting = false;
let suppressBlurHide = false;
let registeredHotkey: string | null = null;
let pendingNotice: string | null = null;

// Separate profile for tests, so a test run doesn't touch the real settings.
if (process.env.QUICKADD_USER_DATA) app.setPath('userData', process.env.QUICKADD_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start).catch((error) => {
    console.error('[quickadd] startup failed', error);
    app.quit();
  });
}

function start(): void {
  app.setAppUserModelId('com.mindwtr.quickadd');
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  // Env overrides beat Settings; meant for testing against scripts/mock-local-api.mjs.
  const envPort = Number.parseInt(process.env.QUICKADD_API_PORT ?? '', 10);
  const envToken = process.env.QUICKADD_API_TOKEN?.trim();
  api = new LocalApiClient(() => {
    const s = settings.get();
    return { apiPort: Number.isInteger(envPort) ? envPort : s.apiPort, apiToken: envToken || s.apiToken };
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  registerIpc();
  createWindow();
  createTray();
  const hotkeyError = applyHotkey(settings.get().hotkey);
  if (hotkeyError) {
    console.warn(`[quickadd] ${hotkeyError}`);
    pendingNotice = `${hotkeyError} Pick another shortcut in Settings (… menu).`;
  }
  applyStartAtLogin(settings.get().startAtLogin);

  const conn = api.connection();
  console.log(
    `[quickadd] ready; Local API port ${conn.port} (${conn.portSource}), token ${conn.tokenSource}` +
      (conn.configDir ? `, config ${conn.configDir}` : ', no Mindwtr config found'),
  );

  if (!process.argv.includes('--hidden')) {
    win?.webContents.once('did-finish-load', () => showWindow());
  }
  if (selfTest) win?.webContents.once('did-finish-load', () => void runSelfTest());
}

function createWindow(): void {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Mindwtr QuickAdd',
    icon: nativeImage.createFromBitmap(drawIconBgra(64), { width: 64, height: 64 }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');

  win.on('blur', () => {
    if (!suppressBlurHide && !keepOnBlur) win?.hide();
  });
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win?.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || isDev) console.log(`[renderer:${details.level}] ${details.message}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function showWindow(event: ShowEvent = {}): void {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [, height] = win.getSize();
  const x = Math.round(workArea.x + (workArea.width - WINDOW_WIDTH) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.2);
  win.setBounds({ x, y, width: WINDOW_WIDTH, height });
  win.show();
  win.focus();
  win.webContents.send(IPC.shown, pendingNotice ? { ...event, notice: pendingNotice } : event);
  pendingNotice = null;
}

function hideWindow(): void {
  win?.hide();
}

function toggleWindow(): void {
  if (win?.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

function applyHotkey(accelerator: string): string | null {
  if (registeredHotkey === accelerator && globalShortcut.isRegistered(accelerator)) return null;
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, toggleWindow);
  } catch (error) {
    return `"${accelerator}" is not a valid shortcut (${String(error)}).`;
  }
  if (!ok) return `Couldn't register ${accelerator}; another app may be using it.`;
  if (registeredHotkey && registeredHotkey !== accelerator) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = accelerator;
  return null;
}

function applyStartAtLogin(enabled: boolean): void {
  // In dev this would register the bare electron.exe, so only packaged builds do it.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromBitmap(drawIconBgra(32), { width: 32, height: 32, scaleFactor: 2 }));
  tray.setToolTip('Mindwtr QuickAdd');
  tray.on('click', () => showWindow());
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const current = settings.get();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show  (${current.hotkey.replace(/Control/g, 'Ctrl')})`, click: () => showWindow() },
      { label: 'Settings…', click: () => showWindow({ view: 'settings' }) },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: current.startAtLogin,
        enabled: app.isPackaged,
        click: (item) => {
          settings.set({ startAtLogin: item.checked });
          applyStartAtLogin(item.checked);
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => quit() },
    ]),
  );
}

function quit(): void {
  isQuitting = true;
  app.quit();
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  // Tray app: keep running until Quit.
});
app.on('before-quit', () => {
  isQuitting = true;
});

function fromOurWindow(event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return !!win && event.sender === win.webContents;
}

function registerIpc(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromOurWindow(event)) throw new Error('Unexpected sender');
      return fn(...(args as A));
    });
  };

  handle(IPC.listAreas, () => api.listAreas());
  handle(IPC.listProjects, () => api.listProjects());
  handle(IPC.knownTokens, () => api.knownTokens());
  handle(IPC.createTasks, (items: CreateTaskInput[]) => {
    if (!Array.isArray(items)) throw new Error('createTasks expects an array');
    const clean = items
      .filter((item) => item && typeof item.title === 'string' && item.title.trim())
      .map((item) => ({
        title: item.title.trim(),
        props: item.props && typeof item.props === 'object' ? item.props : {},
        newProject:
          item.newProject && typeof item.newProject.title === 'string'
            ? {
                title: item.newProject.title,
                areaId: typeof item.newProject.areaId === 'string' ? item.newProject.areaId : undefined,
              }
            : undefined,
      }));
    return api.createTasks(clean);
  });
  // Mindwtr's own task link (what "Copy task link" produces) opens the task's editor.
  handle(IPC.openTask, async (taskId: unknown) => {
    if (typeof taskId !== 'string' || !/^[\w-]{1,128}$/.test(taskId)) throw new Error('Invalid task id');
    hideWindow();
    // Give Mindwtr a moment to load the task the Local API just wrote, so the
    // link doesn't land before the task exists in its UI.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await shell.openExternal(`mindwtr://open?task=${encodeURIComponent(taskId)}`);
  });
  handle(IPC.importTxt, async () => {
    if (!win) return null;
    suppressBlurHide = true;
    try {
      const result = await dialog.showOpenDialog(win, {
        title: 'Import tasks from a text file',
        properties: ['openFile'],
        filters: [
          { name: 'Text files', extensions: ['txt', 'md'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const path = result.filePaths[0];
      if (statSync(path).size > 2 * 1024 * 1024) throw new Error('File is larger than 2 MB.');
      const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
      return { path, text };
    } finally {
      suppressBlurHide = false;
      win?.focus();
    }
  });
  handle(IPC.saveRecording, (data: ArrayBuffer, mimeType: string) => {
    const dir = join(app.getPath('userData'), 'recordings');
    mkdirSync(dir, { recursive: true });
    const ext = /ogg/.test(mimeType) ? 'ogg' : /mp4|aac/.test(mimeType) ? 'm4a' : 'webm';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const fileName = `audio-${stamp}.${ext}`;
    const path = join(dir, fileName);
    const buffer = Buffer.from(data);
    writeFileSync(path, buffer);
    return { path, fileName, size: buffer.length, mimeType: mimeType || 'audio/webm' };
  });
  handle(IPC.getSettings, () => settings.get());
  handle(IPC.setSettings, (patch: Partial<Settings>) => {
    const before = settings.get();
    let error: string | undefined;
    const next: Partial<Settings> = { ...patch };
    if (typeof patch.hotkey === 'string' && patch.hotkey !== before.hotkey) {
      const hotkeyError = applyHotkey(patch.hotkey);
      if (hotkeyError) {
        error = hotkeyError;
        delete next.hotkey;
      }
    }
    const saved = settings.set(next);
    if (saved.startAtLogin !== before.startAtLogin) applyStartAtLogin(saved.startAtLogin);
    rebuildTrayMenu();
    return { settings: saved, error };
  });
  handle(IPC.connectionInfo, () => {
    const { token: _token, ...info } = api.connection();
    return info;
  });

  ipcMain.on(IPC.resize, (event, height: unknown) => {
    if (!fromOurWindow(event) || !win || typeof height !== 'number' || !Number.isFinite(height)) return;
    const bounds = win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const next = Math.round(Math.min(Math.max(height, MIN_HEIGHT), workArea.height - 40));
    if (next !== bounds.height) win.setBounds({ ...bounds, width: WINDOW_WIDTH, height: next });
  });
  ipcMain.on(IPC.hide, (event) => {
    if (fromOurWindow(event)) hideWindow();
  });
  ipcMain.on(IPC.quit, (event) => {
    if (fromOurWindow(event)) quit();
  });
}

// QUICKADD_SELFTEST=1: smoke test against scripts/mock-local-api.mjs, then exit.
// 1) calls the bridge directly (preload -> IPC -> main -> Local API);
// 2) types into the real UI and presses Enter, so parser + React + IPC run end to end.
async function runSelfTest(): Promise<void> {
  if (!win) return;
  try {
    const direct = await win.webContents.executeJavaScript(`(async () => {
      const qa = window.quickAdd;
      const areas = await qa.listAreas();
      const projects = await qa.listProjects();
      const tokens = await qa.knownTokens();
      const created = await qa.createTasks([{ title: 'Self-test task', props: { contexts: ['@phone'], priority: 'high' } }]);
      const file = await qa.saveRecording(new Uint8Array([26, 69, 223, 163]).buffer, 'audio/webm');
      const stamp = new Date().toISOString();
      const audio = await qa.createTasks([{ title: 'Audio note (self-test)', props: { attachments: [{
        id: crypto.randomUUID(), kind: 'file', title: file.fileName, uri: file.path, mimeType: file.mimeType,
        size: file.size, createdAt: stamp, updatedAt: stamp }] } }]);
      created.push(...audio);
      const withNewProject = await qa.createTasks([
        { title: 'Pack boxes', props: {}, newProject: { title: 'Moving', areaId: 'area-home' } },
        { title: 'Book van', props: {}, newProject: { title: 'moving', areaId: 'area-home' } },
      ]);
      created.push(...withNewProject.map((c) => (c.ok ? { ok: true, task: { id: c.task.id + ' project=' + c.task.projectId } } : c)));
      return {
        areas: areas.ok ? areas.data.map((a) => a.name) : areas.error,
        projects: projects.ok ? projects.data.map((p) => p.title) : projects.error,
        tokens: tokens.ok ? tokens.data : tokens.error,
        created: created.map((c) => (c.ok ? c.task.id : c.error)),
      };
    })()`);
    console.log(`[quickadd:selftest] bridge ${JSON.stringify(direct)}`);
    const heightBefore = win.getBounds().height;
    const ui = await win.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await sleep(300);
      const ta = document.querySelector('textarea.hl-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'Call mom due:tomorrow @phone !1 #idea +Garden [docs](https://example.com)');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      const marks = [...document.querySelectorAll('mark.hl-token')].map((m) => m.className.replace('hl-token ', '') + ':' + m.textContent);
      const chips = [...document.querySelectorAll('.chips .chip')].map((c) => c.textContent);
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(400);
      const status = document.querySelector('.ok-text')?.textContent ?? document.querySelector('.banner')?.textContent ?? null;
      return { marks, chips, status };
    })()`);
    console.log(`[quickadd:selftest] ui ${JSON.stringify(ui)} windowHeight ${heightBefore} -> ${win.getBounds().height}`);
  } catch (error) {
    console.error('[quickadd:selftest] failed', error);
    process.exitCode = 1;
  } finally {
    setTimeout(quit, 300);
  }
}
