import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC, type Api, type AppState } from '../shared/types'

const api: Api = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, s: AppState): void => cb(s)
    ipcRenderer.on(IPC.push, handler)
    return () => {
      ipcRenderer.removeListener(IPC.push, handler)
    }
  },
  saveCurrent: (name) => ipcRenderer.invoke(IPC.saveCurrent, name),
  switchTo: (id, restartRuns) => ipcRenderer.invoke(IPC.switchTo, id, restartRuns),
  renameSlot: (id, name) => ipcRenderer.invoke(IPC.renameSlot, id, name),
  deleteSlot: (id) => ipcRenderer.invoke(IPC.deleteSlot, id),
  refreshUsage: () => ipcRenderer.invoke(IPC.refreshUsage),
  clearExhausted: () => ipcRenderer.invoke(IPC.clearExhausted),
  startLogin: (browser, reloginSlotId) =>
    ipcRenderer.invoke(IPC.startLogin, browser, reloginSlotId),
  cancelLogin: () => ipcRenderer.invoke(IPC.cancelLogin),
  completeLogin: (name) => ipcRenderer.invoke(IPC.completeLogin, name),
  copyLoginUrl: () => ipcRenderer.invoke(IPC.copyLoginUrl),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  launch: (folder, cont) => ipcRenderer.invoke(IPC.launch, folder, cont),
  setConfig: (patch) => ipcRenderer.invoke(IPC.setConfig, patch),
  installIntegration: () => ipcRenderer.invoke(IPC.installIntegration),
  uninstallIntegration: () => ipcRenderer.invoke(IPC.uninstallIntegration),
  agySaveCurrent: (name) => ipcRenderer.invoke(IPC.agySaveCurrent, name),
  agySwitch: (id) => ipcRenderer.invoke(IPC.agySwitch, id),
  agyRename: (id, name) => ipcRenderer.invoke(IPC.agyRename, id, name),
  agyDelete: (id) => ipcRenderer.invoke(IPC.agyDelete, id),
  agyStartLogin: () => ipcRenderer.invoke(IPC.agyStartLogin),
  agyCancelLogin: () => ipcRenderer.invoke(IPC.agyCancelLogin),
  agyFinishLogin: () => ipcRenderer.invoke(IPC.agyFinishLogin),
  agyRefreshQuota: () => ipcRenderer.invoke(IPC.agyRefreshQuota),
  setRouting: (r) => ipcRenderer.invoke(IPC.setRouting, r)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
