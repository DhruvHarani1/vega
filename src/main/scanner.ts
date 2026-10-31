import { createHash } from 'node:crypto'
import { mkdir, readdir, stat, writeFile, access } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { isAudioFile, type ScanProgress } from '@shared/library'
import type { LibraryDb, TrackInput } from './db'

const CONCURRENCY = 6

export const trackIdFor = (path: string): string => createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)

async function* walk(dir: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // unreadable directory: skip, do not fail the scan
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (e.isFile() && isAudioFile(e.name)) yield full
  }
}

interface Parsed {
  title: string
  artists: string[]
  album: string | null
  genre: string | null
  year: number | null
  trackNo: number | null
  durationMs: number
  art: string | null
}

async function readTags(path: string, artDir: string): Promise<Parsed> {
  const { parseFile, selectCover } = await import('music-metadata')
  const meta = await parseFile(path, { duration: true })
  const c = meta.common
  const artists = c.artists?.length ? c.artists : c.artist ? [c.artist] : ['Unknown Artist']
  let art: string | null = null
  const cover = selectCover(c.picture)
  if (cover) {
    const key = createHash('sha1')
      .update(`${c.albumartist ?? artists[0]}|${c.album ?? basename(path)}`)
      .digest('hex')
      .slice(0, 16)
    const ext = cover.format.includes('png') ? 'png' : 'jpg'
    const file = `${key}.${ext}`
    const out = join(artDir, file)
    try {
      await access(out)
    } catch {
      await writeFile(out, cover.data)
    }
    art = file
  }
  return {
    title: c.title?.trim() || basename(path, extname(path)),
    artists,
    album: c.album?.trim() || null,
    genre: c.genre?.[0] ?? null,
    year: c.year ?? null,
    trackNo: c.track.no ?? null,
    durationMs: Math.round((meta.format.duration ?? 0) * 1000),
    art
  }
}

/**
 * Incremental scan: unchanged files (same size + mtime) are skipped, new/changed files are parsed,
 * files that disappeared are removed. Everything is written in batched transactions.
 */
export async function scanFolder(
  db: LibraryDb,
  folderId: number,
  folderPath: string,
  artDir: string,
  onProgress: (p: ScanProgress) => void
): Promise<void> {
  const base = { folderId: String(folderId), scanned: 0, total: 0, added: 0, removed: 0 }
  try {
    await mkdir(artDir, { recursive: true })
    onProgress({ ...base, phase: 'walking' })
    const known = db.knownFiles(folderId)
    const seen = new Set<string>()
    const todo: { path: string; size: number; mtime: number }[] = []

    for await (const path of walk(folderPath)) {
      seen.add(path)
      let st
      try {
        st = await stat(path)
      } catch {
        continue
      }
      const mtime = Math.round(st.mtimeMs)
      const prev = known.get(path)
      if (!prev || prev.available === 0 || prev.size !== st.size || prev.mtime !== mtime) todo.push({ path, size: st.size, mtime })
      if (seen.size % 200 === 0) onProgress({ ...base, phase: 'walking', total: seen.size })
    }

    const gone = [...known.entries()].filter(([p]) => !seen.has(p)).map(([, v]) => v.id)
    if (gone.length) db.transaction(() => db.markMissing(gone))

    let scanned = 0
    let added = 0
    let batch: TrackInput[] = []
    const flush = (): void => {
      if (!batch.length) return
      const b = batch
      batch = []
      db.transaction(() => b.forEach((t) => db.upsertTrack(t)))
    }

    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < todo.length) {
        const f = todo[cursor++]!
        try {
          const t = await readTags(f.path, artDir)
          batch.push({
            id: known.get(f.path)?.id ?? trackIdFor(f.path),
            folder_id: folderId,
            path: f.path,
            size: f.size,
            mtime: f.mtime,
            title: t.title,
            artist: t.artists[0] ?? 'Unknown Artist',
            artists_json: JSON.stringify(t.artists),
            album: t.album,
            genre: t.genre,
            year: t.year,
            track_no: t.trackNo,
            duration_ms: t.durationMs,
            art: t.art
          })
          added++
        } catch {
          // corrupt or unsupported file: skip it, keep scanning
        }
        scanned++
        if (batch.length >= 100) flush()
        if (scanned % 10 === 0 || scanned === todo.length) {
          onProgress({ ...base, phase: 'reading', scanned, total: todo.length, added, removed: gone.length })
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    flush()
    db.markScanned(folderId)
    onProgress({ ...base, phase: 'done', scanned, total: todo.length, added, removed: gone.length })
  } catch (err) {
    onProgress({ ...base, phase: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
