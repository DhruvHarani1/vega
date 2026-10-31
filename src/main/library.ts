import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_SCHEME, CH, EV, MEDIA_SCHEME } from '@shared/ipc'
import type { ScanProgress } from '@shared/library'
import { LibraryDb, rowToTrack } from './db'
import { scanFolder } from './scanner'
import { proxyStream } from './streamProxy'
import { YtDlp, assetName } from './ytdlp'
import { YtMusic } from './ytmusic'
import { DEFAULT_MAX_MB, StreamCache, decodeStreamUrl, isAllowedStreamUrl } from './streamCache'

let db: LibraryDb
let artDir = ''
let cache: StreamCache
const scanning = new Set<number>()

/** Must run before app is ready: lets the renderer stream <audio> from vega-media:// with Range support. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

function broadcast(p: ScanProgress): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(EV.scanProgress, p)
}

async function runScan(folderId: number): Promise<void> {
  if (scanning.has(folderId)) return
  const folder = db.folderById(folderId)
  if (!folder) return
  scanning.add(folderId)
  try {
    await scanFolder(db, folderId, folder.path, artDir, broadcast)
  } finally {
    scanning.delete(folderId)
  }
}

/** vega-app://app/<path> -> files of the built renderer (out/renderer), with path traversal blocked. */
export function serveApp(rendererDir: string): void {
  const root = resolve(rendererDir)
  protocol.handle(APP_SCHEME, (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html'
    const full = resolve(root, rel.endsWith('/') ? `${rel}index.html` : rel)
    if (full !== root && !full.startsWith(root + sep)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(full).toString())
  })
}

/** Reads one app-state value (stored by the renderer as JSON text). */
export const kvGet = (key: string): string | undefined => db?.kvGetAll()[key]

export function initLibrary(): void {
  const data = app.getPath('userData')
  db = new LibraryDb(join(data, 'vega.db'))
  artDir = join(data, 'art')

  const maxMb = Number(JSON.parse(db.kvGetAll()['cache.maxMb'] ?? 'null')) || DEFAULT_MAX_MB
  cache = new StreamCache(join(data, 'stream-cache'), maxMb * 1024 * 1024, (u) => proxyStream(u, null))
  void cache.evict()

  // vega-media://file/<trackId>  -> the audio file;  vega-media://art/<file> -> cached cover
  // vega-media://stream/<base64url(https url)> -> online stream, played from the disk cache when present
  protocol.handle(MEDIA_SCHEME, async (req) => withCors(await handleMedia(req)))
  const handleMedia = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const target = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (url.hostname === 'stream') {
      const remote = decodeStreamUrl(target)
      if (!isAllowedStreamUrl(remote)) return new Response('forbidden', { status: 403 })
      const hit = await cache.lookup(remote)
      if (hit) return cache.serve(hit.path, hit.meta, req.headers.get('range'))
      void cache.fill(remote) // warm the cache for next time; this play is proxied straight through
      return proxyStream(remote, req.headers.get('range'))
    }
    let path: string | undefined
    if (url.hostname === 'file') path = db.pathOf(target)
    else if (url.hostname === 'art' && /^[0-9a-f]+\.(jpg|png)$/.test(target)) path = join(artDir, target)
    if (!path) return new Response('not found', { status: 404 })
    // net.fetch on file:// honours Range headers, so seeking works
    return net.fetch(pathToFileURL(path).toString(), { headers: req.headers })
  }

  ipcMain.handle(CH.folders, () => db.folders())

  ipcMain.handle(CH.addFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, { title: 'Add music folder', properties: ['openDirectory'] })
    const dir = res.filePaths[0]
    if (res.canceled || !dir) return null
    const { id } = db.addFolder(dir)
    void runScan(id)
    return db.folders().find((f) => f.id === String(id)) ?? null
  })

  ipcMain.handle(CH.removeFolder, (_e, id: string) => db.removeFolder(Number(id)))

  ipcMain.handle(CH.rescan, async (_e, id?: string) => {
    const ids = id ? [Number(id)] : db.folders().map((f) => Number(f.id))
    await Promise.all(ids.map(runScan))
  })

  ipcMain.handle(CH.search, (_e, q: string, limit: number) => db.search(String(q), clamp(limit)).map(rowToTrack))
  ipcMain.handle(CH.all, (_e, limit: number) => db.all(clamp(limit)).map(rowToTrack))
  ipcMain.handle(CH.getTrack, (_e, id: string) => {
    const r = db.getTrack(String(id))
    return r ? rowToTrack(r) : null
  })

  ipcMain.handle(CH.relinkTrack, async (e, id: string) => {
    const current = db.getTrack(String(id))
    if (!current) return false
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: `Locate ${current.title}`,
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'weba'] }]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return false
    const folder = db.addFolder(dirname(path))
    db.relinkTrack(String(id), path, folder.id)
    await runScan(folder.id)
    return true
  })
  // yt-dlp ships inside the app (resources/bin); a copy updated from Sources lives in userData and wins
  const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const ytdlp = new YtDlp(join(data, 'bin'), [join(resources, 'bin', 'yt-dlp', assetName(process.platform)), join(resources, 'bin', assetName(process.platform))])
  const ytm = new YtMusic((u, init) => net.fetch(u, init))
  ipcMain.handle(CH.ytmSearch, (_e, q: string, limit: number, kind?: string) => ytm.search(String(q), Math.min(40, Number(limit) || 20), kind === 'videos' ? 'videos' : 'songs'))
  ipcMain.handle(CH.ytWarm, (_e, id: string) => ytdlp.warm(String(id)))
  ipcMain.handle(CH.ytStatus, () => ytdlp.status())
  ipcMain.handle(CH.ytInstall, async () => {
    try {
      await ytdlp.install((u) => net.fetch(u))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(CH.ytSearch, (_e, q: string, limit: number) => ytdlp.search(String(q), Number(limit) || 10))
  ipcMain.handle(CH.ytVideo, (_e, id: string, h?: number) => ytdlp.videoUrl(String(id), Number(h) || 1080))
  ipcMain.handle(CH.ytResolve, (_e, id: string) => ytdlp.streamUrl(String(id)))
  ipcMain.handle(CH.cacheStats, () => cache.stats())
  ipcMain.handle(CH.cacheClear, () => cache.clear())
  ipcMain.handle(CH.cacheSetMax, (_e, mb: number) => {
    const n = Math.min(100_000, Math.max(50, Math.round(Number(mb)) || DEFAULT_MAX_MB))
    db.kvSet('cache.maxMb', JSON.stringify(n))
    cache.setMaxBytes(n * 1024 * 1024)
    return n
  })
  ipcMain.handle(CH.kvGetAll, () => db.kvGetAll())
  ipcMain.handle(CH.kvSet, (_e, key: string, value: string) => db.kvSet(String(key), String(value)))

  app.on('will-quit', () => db.close())
}

/** The renderer reads media through Web Audio (equalizer), which requires CORS; the protocol is only reachable from our own UI. */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

const clamp = (n: unknown): number => Math.min(50_000, Math.max(1, Number(n) || 100))
