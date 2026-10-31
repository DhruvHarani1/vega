import { isAudioFile, type FolderInfo, type LibraryBackend, type ScanProgress } from '@shared/library'
import type { Track } from '@shared/types'

/**
 * Web backend: IndexedDB for metadata + the File System Access API for audio (Chromium browsers).
 * Files are never uploaded or copied; the browser keeps a handle to the user's folder and reads from disk.
 */

// Minimal File System Access typings (not in every lib.dom version).
interface FsHandle {
  kind: 'file' | 'directory'
  name: string
}
interface FsFileHandle extends FsHandle {
  kind: 'file'
  getFile(): Promise<File>
}
interface FsDirHandle extends FsHandle {
  kind: 'directory'
  entries(): AsyncIterable<[string, FsFileHandle | FsDirHandle]>
  getDirectoryHandle(name: string): Promise<FsDirHandle>
  getFileHandle(name: string): Promise<FsFileHandle>
  queryPermission(d: { mode: 'read' }): Promise<PermissionState>
  requestPermission(d: { mode: 'read' }): Promise<PermissionState>
}
declare global {
  interface Window {
    showDirectoryPicker?: (o?: { mode?: 'read' }) => Promise<FsDirHandle>
  }
}

interface FolderRec {
  id: string
  name: string
  handle: FsDirHandle
  lastScan: number | null
}
interface TrackRec {
  id: string
  folderId: string
  pathParts: string[]
  size: number
  mtime: number
  title: string
  artists: string[]
  album?: string
  genre?: string
  year?: number
  trackNo?: number
  durationMs: number
  artKey?: string
  available?: boolean
}

const DB_NAME = 'vega'
const STORES = ['folders', 'tracks', 'art', 'kv'] as const

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      for (const s of STORES) req.result.createObjectStore(s, s === 'kv' ? undefined : { keyPath: s === 'art' ? 'key' : 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const done = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  })

const norm = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

async function hashPath(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function* walk(dir: FsDirHandle, parts: string[] = []): AsyncGenerator<{ parts: string[]; handle: FsFileHandle }> {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue
    if (h.kind === 'directory') yield* walk(h, [...parts, name])
    else if (isAudioFile(name)) yield { parts: [...parts, name], handle: h }
  }
}

export function createWebBackend(): LibraryBackend {
  const supported = typeof window.showDirectoryPicker === 'function'
  let dbp: Promise<IDBDatabase> | null = null
  const db = (): Promise<IDBDatabase> => (dbp ??= openDb())
  const listeners = new Set<(p: ScanProgress) => void>()
  const emit = (p: ScanProgress): void => listeners.forEach((l) => l(p))

  let tracks: TrackRec[] | null = null // in-memory index for instant search
  let haystack = new Map<string, string>()
  const artUrls = new Map<string, string>()
  const folderCache = new Map<string, FolderRec>()
  const streamUrls = new Map<string, string>()

  async function loadIndex(): Promise<TrackRec[]> {
    if (tracks) return tracks
    const d = await db()
    tracks = await done(d.transaction('tracks').objectStore('tracks').getAll() as IDBRequest<TrackRec[]>)
    haystack = new Map(tracks.map((t) => [t.id, norm(`${t.title} ${t.artists.join(' ')} ${t.album ?? ''} ${t.genre ?? ''}`)]))
    const arts = await done(d.transaction('art').objectStore('art').getAll() as IDBRequest<{ key: string; blob: Blob }[]>)
    for (const a of arts) if (!artUrls.has(a.key)) artUrls.set(a.key, URL.createObjectURL(a.blob))
    return tracks
  }

  async function folderRecs(): Promise<FolderRec[]> {
    const d = await db()
    const recs = await done(d.transaction('folders').objectStore('folders').getAll() as IDBRequest<FolderRec[]>)
    recs.forEach((r) => folderCache.set(r.id, r))
    return recs
  }

  const toTrack = (t: TrackRec): Track => ({
    ref: { source: 'local', id: t.id },
    title: t.title,
    artists: t.artists,
    album: t.album,
    genres: t.genre ? [t.genre] : undefined,
    year: t.year,
    durationMs: t.durationMs,
    artworkUrl: t.artKey ? artUrls.get(t.artKey) : undefined,
    available: t.available !== false
  })

  async function info(r: FolderRec): Promise<FolderInfo> {
    const ts = await loadIndex()
    let needsPermission = false
    try {
      needsPermission = (await r.handle.queryPermission({ mode: 'read' })) !== 'granted'
    } catch {
      needsPermission = true
    }
    return { id: r.id, path: r.name, trackCount: ts.filter((t) => t.folderId === r.id).length, lastScan: r.lastScan, needsPermission }
  }

  async function scan(r: FolderRec): Promise<void> {
    const base = { folderId: r.id, scanned: 0, total: 0, added: 0, removed: 0 }
    try {
      if ((await r.handle.queryPermission({ mode: 'read' })) !== 'granted') throw new Error('Access to this folder was not granted')
      emit({ ...base, phase: 'walking' })
      const existing = new Map((await loadIndex()).filter((t) => t.folderId === r.id).map((t) => [t.pathParts.join('/'), t]))
      const seen = new Set<string>()
      const todo: { parts: string[]; file: File }[] = []
      for await (const { parts, handle } of walk(r.handle)) {
        const key = parts.join('/')
        seen.add(key)
        const file = await handle.getFile()
        const prev = existing.get(key)
        if (!prev || prev.available === false || prev.size !== file.size || prev.mtime !== file.lastModified) todo.push({ parts, file })
        if (seen.size % 100 === 0) emit({ ...base, phase: 'walking', total: seen.size })
      }
      const goneIds = [...existing.entries()].filter(([k]) => !seen.has(k)).map(([, t]) => t.id)

      const { parseBlob, selectCover } = await import('music-metadata')
      const d = await db()
      const out: TrackRec[] = []
      const arts: { key: string; blob: Blob }[] = []
      let scanned = 0
      for (const f of todo) {
        try {
          const meta = await parseBlob(f.file, { duration: true })
          const c = meta.common
          const artists = c.artists?.length ? c.artists : c.artist ? [c.artist] : ['Unknown Artist']
          let artKey: string | undefined
          const cover = selectCover(c.picture)
          if (cover) {
            artKey = await hashPath(`${c.albumartist ?? artists[0]}|${c.album ?? f.file.name}`)
            if (!artUrls.has(artKey) && !arts.some((a) => a.key === artKey)) {
              arts.push({ key: artKey, blob: new Blob([cover.data as BlobPart], { type: cover.format }) })
            }
          }
          const title = c.title?.trim() || f.file.name.replace(/\.[^.]+$/, '')
          out.push({
            id: `${r.id}-${await hashPath(f.parts.join('/'))}`,
            folderId: r.id,
            pathParts: f.parts,
            size: f.file.size,
            mtime: f.file.lastModified,
            title,
            artists,
            album: c.album?.trim() || undefined,
            genre: c.genre?.[0],
            year: c.year,
            trackNo: c.track.no ?? undefined,
            durationMs: Math.round((meta.format.duration ?? 0) * 1000),
            artKey,
            available: true
          })
        } catch {
          // unreadable or unsupported file: skip
        }
        scanned++
        if (scanned % 5 === 0) emit({ ...base, phase: 'reading', scanned, total: todo.length, added: out.length, removed: goneIds.length })
      }

      const tx = d.transaction(['tracks', 'art', 'folders'], 'readwrite')
      for (const id of goneIds) {
        const missing = existing.get([...existing.entries()].find(([, track]) => track.id === id)?.[0] ?? '')
        if (missing) tx.objectStore('tracks').put({ ...missing, available: false })
      }
      for (const t of out) tx.objectStore('tracks').put(t)
      for (const a of arts) tx.objectStore('art').put(a)
      r.lastScan = Date.now()
      tx.objectStore('folders').put(r)
      await txDone(tx)
      for (const a of arts) artUrls.set(a.key, URL.createObjectURL(a.blob))
      tracks = null // rebuild index lazily
      await loadIndex()
      emit({ ...base, phase: 'done', scanned, total: todo.length, added: out.length, removed: goneIds.length })
    } catch (err) {
      emit({ ...base, phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function fileFor(t: TrackRec): Promise<File> {
    const f = folderCache.get(t.folderId) ?? (await folderRecs()).find((x) => x.id === t.folderId)
    if (!f) throw new Error('folder missing')
    let dir = f.handle
    for (const p of t.pathParts.slice(0, -1)) dir = await dir.getDirectoryHandle(p)
    return (await dir.getFileHandle(t.pathParts[t.pathParts.length - 1]!)).getFile()
  }

  return {
    kind: 'web',
    supported,
    folders: async () => Promise.all((await folderRecs()).map(info)),

    async addFolder() {
      if (!window.showDirectoryPicker) return null
      let handle: FsDirHandle
      try {
        handle = await window.showDirectoryPicker({ mode: 'read' })
      } catch {
        return null // user cancelled
      }
      const rec: FolderRec = { id: Math.random().toString(36).slice(2, 10), name: handle.name, handle, lastScan: null }
      const d = await db()
      const tx = d.transaction('folders', 'readwrite')
      tx.objectStore('folders').put(rec)
      await txDone(tx)
      folderCache.set(rec.id, rec)
      void scan(rec)
      return info(rec)
    },

    async removeFolder(id) {
      const d = await db()
      const ids = (await loadIndex()).filter((t) => t.folderId === id).map((t) => t.id)
      const tx = d.transaction(['folders', 'tracks'], 'readwrite')
      tx.objectStore('folders').delete(id)
      for (const t of ids) tx.objectStore('tracks').delete(t)
      await txDone(tx)
      folderCache.delete(id)
      tracks = null
      await loadIndex()
    },

    async rescan(id) {
      const recs = (await folderRecs()).filter((r) => !id || r.id === id)
      for (const r of recs) await scan(r)
    },

    async grantAccess(id) {
      const r = (await folderRecs()).find((x) => x.id === id)
      if (!r) return false
      const ok = (await r.handle.requestPermission({ mode: 'read' })) === 'granted'
      if (ok) void scan(r)
      return ok
    },

    onScanProgress(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },

    async search(q, limit) {
      const words = norm(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      if (!words.length) return []
      const ts = await loadIndex()
      const hits: { t: TrackRec; score: number }[] = []
      for (const t of ts) {
        const hay = haystack.get(t.id) ?? ''
        const tokens = hay.split(/[^\p{L}\p{N}]+/u)
        if (!words.every((w) => tokens.some((tok) => tok.startsWith(w)))) continue
        const title = norm(t.title)
        hits.push({ t, score: words.filter((w) => title.startsWith(w) || title.includes(` ${w}`)).length })
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, limit).map((h) => toTrack(h.t))
    },

    async all(limit) {
      const ts = [...(await loadIndex())].sort(
        (a, b) =>
          (a.artists[0] ?? '').localeCompare(b.artists[0] ?? '') ||
          (a.album ?? '').localeCompare(b.album ?? '') ||
          (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
          a.title.localeCompare(b.title)
      )
      return ts.slice(0, limit).map(toTrack)
    },

    async getTrack(id) {
      const t = (await loadIndex()).find((x) => x.id === id)
      return t ? toTrack(t) : null
    },

    async streamUrl(id) {
      const cached = streamUrls.get(id)
      if (cached) return cached
      const t = (await loadIndex()).find((x) => x.id === id)
      if (!t) throw new Error('track not found')
      const url = URL.createObjectURL(await fileFor(t))
      streamUrls.set(id, url)
      if (streamUrls.size > 12) {
        const [oldest] = streamUrls.keys()
        if (oldest && oldest !== id) {
          URL.revokeObjectURL(streamUrls.get(oldest)!)
          streamUrls.delete(oldest)
        }
      }
      return url
    },

    async kvGetAll() {
      const d = await db()
      const store = d.transaction('kv').objectStore('kv')
      const [keys, vals] = await Promise.all([done(store.getAllKeys()), done(store.getAll())])
      return Object.fromEntries(keys.map((k, i) => [String(k), String(vals[i])]))
    },

    async kvSet(key, value) {
      const d = await db()
      const tx = d.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(value, key)
      await txDone(tx)
    }
  }
}
