import type { Track } from './types'

export interface FolderInfo {
  id: string
  /** Display path (desktop: absolute path; web: directory name). */
  path: string
  trackCount: number
  lastScan: number | null
  /** Web only: the browser must be granted access again after a restart. */
  needsPermission?: boolean
}

export interface ScanProgress {
  folderId: string
  phase: 'walking' | 'reading' | 'done' | 'error'
  scanned: number
  total: number
  added: number
  removed: number
  message?: string
}

/**
 * Where the local library lives. Two implementations behind one interface:
 *  - desktop: SQLite in the Electron main process, reached over IPC
 *  - web: IndexedDB + File System Access API in the browser
 * The renderer, the local provider and the UI only ever see this.
 */
export interface LibraryBackend {
  readonly kind: 'desktop' | 'web'
  /** False when the platform cannot host a local library (e.g. a browser without directory access). */
  readonly supported: boolean
  folders(): Promise<FolderInfo[]>
  /** Opens the native/browser folder picker. Resolves to null if the user cancels. */
  addFolder(): Promise<FolderInfo | null>
  removeFolder(id: string): Promise<void>
  /** Re-reads a folder; omit id for all. Resolves when finished. */
  rescan(id?: string): Promise<void>
  /** Web: re-grant access to a folder handle after restart (needs a user gesture). */
  grantAccess?(id: string): Promise<boolean>
  onScanProgress(cb: (p: ScanProgress) => void): () => void
  search(q: string, limit: number): Promise<Track[]>
  all(limit: number): Promise<Track[]>
  getTrack(id: string): Promise<Track | null>
  /** Desktop: locate a missing local file and reconnect it to its existing track entry. */
  relinkTrack?(id: string): Promise<boolean>
  /** A URL an <audio> element can play. Web returns an object URL, desktop a vega-media:// URL. */
  streamUrl(id: string): Promise<string>
  /** Desktop only: routes an online stream URL through the main-process disk cache. */
  proxyStream?(url: string): string
  /** Small durable key/value store for app state (likes, playlists, play history). */
  kvGetAll(): Promise<Record<string, string>>
  kvSet(key: string, value: string): Promise<void>
}

export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.weba'] as const

export const isAudioFile = (name: string): boolean => {
  const i = name.lastIndexOf('.')
  return i >= 0 && (AUDIO_EXTENSIONS as readonly string[]).includes(name.slice(i).toLowerCase())
}

/** Builds a safe FTS5 MATCH expression: every word is a quoted prefix term, all must match. */
export function ftsQuery(q: string): string | null {
  const words = q
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  return words.length ? words.map((w) => `"${w}"*`).join(' ') : null
}
