import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH, EV, UPDATE_CH, type UpdateState, type VegaDesktopApi } from '@shared/ipc'
import type { ScanProgress } from '@shared/library'

const invoke = <T>(ch: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(ch, ...args) as Promise<T>

const api: VegaDesktopApi = {
  platform: process.platform,
  library: {
    folders: () => invoke(CH.folders),
    addFolder: () => invoke(CH.addFolder),
    removeFolder: (id) => invoke(CH.removeFolder, id),
    rescan: (id) => invoke(CH.rescan, id),
    search: (q, limit) => invoke(CH.search, q, limit),
    all: (limit) => invoke(CH.all, limit),
    getTrack: (id) => invoke(CH.getTrack, id),
    relinkTrack: (id) => invoke(CH.relinkTrack, id),
    onScanProgress: (cb) => {
      const l = (_e: IpcRendererEvent, p: ScanProgress): void => cb(p)
      ipcRenderer.on(EV.scanProgress, l)
      return () => ipcRenderer.removeListener(EV.scanProgress, l)
    }
  },
  cache: {
    stats: () => invoke(CH.cacheStats),
    clear: () => invoke(CH.cacheClear),
    setMaxMb: (mb) => invoke(CH.cacheSetMax, mb)
  },
  app: { info: () => invoke(UPDATE_CH.info) },
  update: {
    get: () => invoke(UPDATE_CH.get),
    check: () => invoke(UPDATE_CH.check),
    install: () => invoke(UPDATE_CH.install),
    onState: (cb) => {
      const l = (_e: IpcRendererEvent, s: UpdateState): void => cb(s)
      ipcRenderer.on(UPDATE_CH.state, l)
      return () => ipcRenderer.removeListener(UPDATE_CH.state, l)
    }
  },
  ytdlp: {
    status: () => invoke(CH.ytStatus),
    install: () => invoke(CH.ytInstall),
    search: (q, limit) => invoke(CH.ytSearch, q, limit),
    resolve: (id) => invoke(CH.ytResolve, id),
    video: (id, maxHeight) => invoke(CH.ytVideo, id, maxHeight),
    warm: (id) => invoke(CH.ytWarm, id)
  },
  ytm: { search: (q, limit, kind) => invoke(CH.ytmSearch, q, limit, kind) },
  kv: {
    getAll: () => invoke(CH.kvGetAll),
    set: (key, value) => invoke(CH.kvSet, key, value)
  }
}

contextBridge.exposeInMainWorld('vega', api)
