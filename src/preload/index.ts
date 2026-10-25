import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type QuickAddBridge, type ShowEvent } from './api';

const bridge: QuickAddBridge = {
  isElectron: true,
  listAreas: () => ipcRenderer.invoke(IPC.listAreas),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  knownTokens: () => ipcRenderer.invoke(IPC.knownTokens),
  createTasks: (items) => ipcRenderer.invoke(IPC.createTasks, items),
  importTxt: () => ipcRenderer.invoke(IPC.importTxt),
  saveRecording: (data, mimeType) => ipcRenderer.invoke(IPC.saveRecording, data, mimeType),
  resize: (height) => ipcRenderer.send(IPC.resize, height),
  hide: () => ipcRenderer.send(IPC.hide),
  quit: () => ipcRenderer.send(IPC.quit),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  connectionInfo: () => ipcRenderer.invoke(IPC.connectionInfo),
  onShow: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: ShowEvent) => callback(payload ?? {});
    ipcRenderer.on(IPC.shown, listener);
    return () => {
      ipcRenderer.removeListener(IPC.shown, listener);
    };
  },
};

contextBridge.exposeInMainWorld('quickAdd', bridge);
