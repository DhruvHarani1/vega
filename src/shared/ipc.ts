import type { FolderInfo, ScanProgress } from './library'
import type { Track } from './types'

/** IPC contract between renderer and Electron main. Keep in sync with preload/index.ts. */
export const CH = {
  folders: 'library:folders',
  addFolder: 'library:addFolder',
  removeFolder: 'library:removeFolder',
  rescan: 'library:rescan',
  search: 'library:search',
  all: 'library:all',
  getTrack: 'library:getTrack',
  relinkTrack: 'library:relinkTrack',
  kvGetAll: 'kv:getAll',
  kvSet: 'kv:set',
  cacheStats: 'cache:stats',
  cacheClear: 'cache:clear',
  cacheSetMax: 'cache:setMax',
  ytStatus: 'ytdlp:status',
  ytInstall: 'ytdlp:install',
  ytSearch: 'ytdlp:search',
  ytResolve: 'ytdlp:resolve',
  ytVideo: 'ytdlp:video',
  ytWarm: 'ytdlp:warm',
  ytmSearch: 'ytm:search'
} as const

export const EV = {
  scanProgress: 'library:scanProgress'
} as const

export interface VegaDesktopApi {
  platform: string
  library: {
    folders(): Promise<FolderInfo[]>
    addFolder(): Promise<FolderInfo | null>
    removeFolder(id: string): Promise<void>
    rescan(id?: string): Promise<void>
    search(q: string, limit: number): Promise<Track[]>
    all(limit: number): Promise<Track[]>
    getTrack(id: string): Promise<Track | null>
    relinkTrack(id: string): Promise<boolean>
    onScanProgress(cb: (p: ScanProgress) => void): () => void
  }
  cache: {
    stats(): Promise<{ bytes: number; files: number; maxBytes: number }>
    clear(): Promise<void>
    setMaxMb(mb: number): Promise<number>
  }
  app: {
    info(): Promise<{ version: string; platform: string; packaged: boolean }>
  }
  update: {
    get(): Promise<UpdateState>
    check(): Promise<void>
    install(): Promise<void>
    onState(cb: (s: UpdateState) => void): () => void
  }
  ytdlp: {
    status(): Promise<{ installed: boolean; version?: string }>
    install(): Promise<{ ok: boolean; error?: string }>
    search(q: string, limit: number): Promise<{ id: string; title: string; channel: string; durationSec: number }[]>
    resolve(id: string): Promise<string>
    video(id: string, maxHeight?: number): Promise<string>
    warm(id: string): Promise<void>
  }
  ytm: {
    search(q: string, limit: number, kind?: 'songs' | 'videos'): Promise<{ videoId: string; title: string; artists: string[]; album?: string; durationSec: number; thumbnail?: string }[]>
  }
  kv: {
    getAll(): Promise<Record<string, string>>
    set(key: string, value: string): Promise<void>
  }
}

/** Custom protocol that serves library audio/artwork to the renderer (supports Range requests). */
export interface UpdateState {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'none' | 'error' | 'disabled'
  version?: string
  percent?: number
  message?: string
}

export const UPDATE_CH = {
  get: 'update:get',
  check: 'update:check',
  install: 'update:install',
  info: 'app:info',
  state: 'update:state'
} as const

export const MEDIA_SCHEME = 'vega-media'

/** Serves the packaged UI (index.html and Lyra's iframe page) from a real origin instead of file://, so the two pages can talk. */
export const APP_SCHEME = 'vega-app'
