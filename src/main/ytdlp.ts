import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Optional YouTube source through the user's own copy of yt-dlp (https://github.com/yt-dlp/yt-dlp).
 * The installer ships a copy (fetched by scripts/fetch-ytdlp.mjs into resources/bin); a copy the user installs or updates
 * from Sources (downloaded from the official GitHub release, verified against its SHA2-256SUMS) lives in userData and wins.
 * Arguments are always passed as an array (no shell), after `--`.
 */

export interface RunResult {
  stdout: string
  stderr: string
  code: number | null
}
export type Runner = (bin: string, args: string[], opts: { timeoutMs: number }) => Promise<RunResult>

export interface YtEntry {
  id: string
  title: string
  channel: string
  durationSec: number
}

const VIDEO_ID = /^[\w-]{11}$/
const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

export const spawnRunner: Runner = (bin, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const t = setTimeout(() => {
      child.kill()
      reject(new Error('yt-dlp timed out'))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => {
      stdout += d
      if (stdout.length > 8_000_000) child.kill() // runaway output guard
    })
    child.stderr.on('data', (d: Buffer) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(t)
      resolve({ stdout, stderr, code })
    })
  })

export const assetName = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'yt-dlp.exe' : platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp')

/** Search text is passed after `--`, but still keep it tame: no control characters, no leading dash, bounded length. */
export function cleanQuery(q: string): string {
  return q.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/^-+\s*/, '').slice(0, 120)
}

export function parseSearch(stdout: string): YtEntry[] {
  let data: { entries?: Array<{ id?: string; title?: string; channel?: string; uploader?: string; duration?: number | null }> }
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }
  return (data.entries ?? [])
    .filter((e): e is { id: string; title: string; channel?: string; uploader?: string; duration?: number | null } => !!e.id && VIDEO_ID.test(e.id) && !!e.title)
    .map((e) => ({ id: e.id, title: e.title, channel: e.channel || e.uploader || 'YouTube', durationSec: Math.round(e.duration ?? 0) }))
    .filter((e) => e.durationSec > 0 && e.durationSec < 3 * 3600)
}

export class YtDlp {
  private active = 0
  private queue: Array<() => void> = []

  private urlCache = new Map<string, { url: string; at: number }>()
  private inflight = new Map<string, Promise<string>>()

  /**
   * @param binDir     user-writable folder (updates land here and win over the bundled copy)
   * @param bundled    candidate paths of the copy shipped inside the app, tried in order
   */
  constructor(
    private readonly binDir: string,
    private readonly bundled: string[] = [],
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly run: Runner = spawnRunner,
    private readonly now: () => number = Date.now
  ) {}

  /** The newest available binary: a user-updated copy first, then the one bundled with Vega. */
  binaryPath(): string {
    const own = join(this.binDir, assetName(this.platform))
    if (existsSync(own)) return own
    return this.bundled.find((p) => existsSync(p)) ?? own
  }

  /** At most three yt-dlp processes at once. */
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= 3) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }

  async status(): Promise<{ installed: boolean; version?: string }> {
    try {
      await stat(this.binaryPath())
    } catch {
      return { installed: false }
    }
    try {
      const r = await this.run(this.binaryPath(), ['--version'], { timeoutMs: 8000 })
      return r.code === 0 ? { installed: true, version: r.stdout.trim() } : { installed: false }
    } catch {
      return { installed: false }
    }
  }

  /** Downloads the official release binary and checks it against the release's published SHA-256 list. */
  async install(fetchImpl: (url: string) => Promise<Response>): Promise<void> {
    const name = assetName(this.platform)
    const [bin, sums] = await Promise.all([fetchImpl(`${RELEASE}/${name}`), fetchImpl(`${RELEASE}/SHA2-256SUMS`)])
    if (!bin.ok || !sums.ok) throw new Error(`Could not download yt-dlp (${bin.status}/${sums.status})`)
    const data = Buffer.from(await bin.arrayBuffer())
    const expected = (await sums.text())
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .find(([, f]) => f?.replace(/^\*/, '') === name)?.[0]
    const actual = createHash('sha256').update(data).digest('hex')
    if (!expected || expected.toLowerCase() !== actual) throw new Error('Downloaded file failed its checksum; not installed')
    await mkdir(this.binDir, { recursive: true })
    const target = join(this.binDir, name)
    const tmp = `${target}.download`
    await writeFile(tmp, data)
    if (this.platform !== 'win32') await chmod(tmp, 0o755)
    await rm(target, { force: true })
    await rename(tmp, target)
  }

  async search(query: string, limit: number): Promise<YtEntry[]> {
    const q = cleanQuery(query)
    if (!q) return []
    const n = Math.min(20, Math.max(1, Math.round(limit)))
    const r = await this.slot(() => this.run(this.binaryPath(), ['--ignore-config', '--no-warnings', '--flat-playlist', '-J', '--', `ytsearch${n}:${q}`], { timeoutMs: 25_000 }))
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || 'yt-dlp search failed')
    return parseSearch(r.stdout)
  }

  /** Direct URL of the video picture only (no sound), up to maxHeight: used as the muted animated background in Lyra. */
  videoUrl(id: string, maxHeight = 1080): Promise<string> {
    const h = Math.min(2160, Math.max(240, Math.round(maxHeight)))
    return this.cached(`v:${id}:${h}`, id, () => this.resolveVideo(id, h))
  }

  private async resolveVideo(id: string, h: number): Promise<string> {
    const r = await this.slot(() =>
      this.run(
        this.binaryPath(),
        ['--ignore-config', '--no-warnings', '--no-playlist', '-f', `bestvideo[height<=${h}][vcodec^=avc1][ext=mp4]/bestvideo[height<=${h}][ext=mp4]/bestvideo[height<=${h}]`, '-g', '--', `https://www.youtube.com/watch?v=${id}`],
        { timeoutMs: 25_000 }
      )
    )
    const url = r.stdout.trim().split('\n')[0] ?? ''
    if (r.code !== 0 || !url.startsWith('https://')) throw new Error(r.stderr.trim().split('\n').pop() || 'yt-dlp could not resolve this video')
    return url
  }

  /** Direct audio URL for one video (expires after a few hours, so it is resolved just in time). */
  streamUrl(id: string): Promise<string> {
    return this.cached(`a:${id}`, id, () => this.resolveAudio(id))
  }

  /** Resolve in the background so the track is ready when someone presses play (errors are ignored). */
  warm(id: string): void {
    if (VIDEO_ID.test(id)) void this.streamUrl(id).catch(() => undefined)
  }

  /** Cached (about 2 h; the URLs live for ~6 h) and de-duplicated while in flight. */
  private cached(key: string, id: string, load: () => Promise<string>): Promise<string> {
    if (!VIDEO_ID.test(id)) return Promise.reject(new Error('bad video id'))
    const hit = this.urlCache.get(key)
    if (hit && this.now() - hit.at < 2 * 3600_000) return Promise.resolve(hit.url)
    const running = this.inflight.get(key)
    if (running) return running
    const p = load()
      .then((url) => {
        this.urlCache.set(key, { url, at: this.now() })
        if (this.urlCache.size > 300) this.urlCache.delete(this.urlCache.keys().next().value!)
        return url
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  private async resolveAudio(id: string): Promise<string> {
    const r = await this.slot(() =>
      this.run(
        this.binaryPath(),
        ['--ignore-config', '--no-warnings', '--no-playlist', '-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--', `https://www.youtube.com/watch?v=${id}`],
        { timeoutMs: 25_000 }
      )
    )
    const url = r.stdout.trim().split('\n')[0] ?? ''
    if (r.code !== 0 || !url.startsWith('https://')) throw new Error(r.stderr.trim().split('\n').pop() || 'yt-dlp could not resolve this video')
    return url
  }
}

export async function readVersionFile(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return null
  }
}
