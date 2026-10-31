import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { ftsQuery, type FolderInfo } from '@shared/library'
import type { Track } from '@shared/types'

/** Numbered migrations; index + 1 is the schema version stored in PRAGMA user_version. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE folders (
    id        INTEGER PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    added_at  INTEGER NOT NULL,
    last_scan INTEGER
  );
  CREATE TABLE tracks (
    id           TEXT PRIMARY KEY,
    folder_id    INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    path         TEXT NOT NULL UNIQUE,
    size         INTEGER NOT NULL,
    mtime        INTEGER NOT NULL,
    title        TEXT NOT NULL,
    artist       TEXT NOT NULL,
    artists_json TEXT NOT NULL,
    album        TEXT,
    genre        TEXT,
    year         INTEGER,
    track_no     INTEGER,
    duration_ms  INTEGER NOT NULL,
    art          TEXT,
    added_at     INTEGER NOT NULL
  );
  CREATE INDEX tracks_folder ON tracks(folder_id);
  CREATE VIRTUAL TABLE tracks_fts USING fts5(
    title, artist, album, genre,
    content='tracks', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2', prefix='2 3'
  );
  CREATE TRIGGER tracks_ai AFTER INSERT ON tracks BEGIN
    INSERT INTO tracks_fts(rowid, title, artist, album, genre) VALUES (new.rowid, new.title, new.artist, new.album, new.genre);
  END;
  CREATE TRIGGER tracks_ad AFTER DELETE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, genre) VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.genre);
  END;
  CREATE TRIGGER tracks_au AFTER UPDATE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, genre) VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.genre);
    INSERT INTO tracks_fts(rowid, title, artist, album, genre) VALUES (new.rowid, new.title, new.artist, new.album, new.genre);
  END;
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  `ALTER TABLE tracks ADD COLUMN available INTEGER NOT NULL DEFAULT 1;`
]

export interface TrackRow {
  id: string
  path: string
  size: number
  mtime: number
  title: string
  artist: string
  artists_json: string
  album: string | null
  genre: string | null
  year: number | null
  track_no: number | null
  duration_ms: number
  art: string | null
  available: number
}

export type TrackInput = Omit<TrackRow, 'id' | 'available'> & { id: string; folder_id: number }

export function rowToTrack(r: TrackRow): Track {
  return {
    ref: { source: 'local', id: r.id },
    title: r.title,
    artists: JSON.parse(r.artists_json) as string[],
    album: r.album ?? undefined,
    genres: r.genre ? [r.genre] : undefined,
    year: r.year ?? undefined,
    durationMs: r.duration_ms,
    artworkUrl: r.art ? `vega-media://art/${r.art}` : undefined,
    available: r.available === 1
  }
}

export class LibraryDb {
  readonly db: DatabaseSync
  private stmts = new Map<string, StatementSync>()

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
    this.migrate()
  }

  private migrate(): void {
    const current = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[v]!)
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql)
    if (!s) {
      s = this.db.prepare(sql)
      this.stmts.set(sql, s)
    }
    return s
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ---- folders ----
  folders(): FolderInfo[] {
    const rows = this.stmt(
      `SELECT f.id, f.path, f.last_scan, (SELECT COUNT(*) FROM tracks t WHERE t.folder_id = f.id) AS n FROM folders f ORDER BY f.added_at`
    ).all() as { id: number; path: string; last_scan: number | null; n: number }[]
    return rows.map((r) => ({ id: String(r.id), path: r.path, trackCount: r.n, lastScan: r.last_scan }))
  }

  folderById(id: number): { id: number; path: string } | undefined {
    return this.stmt('SELECT id, path FROM folders WHERE id = ?').get(id) as { id: number; path: string } | undefined
  }

  /** Returns the existing folder id when the path is already tracked. */
  addFolder(path: string): { id: number; created: boolean } {
    const existing = this.stmt('SELECT id FROM folders WHERE path = ?').get(path) as { id: number } | undefined
    if (existing) return { id: existing.id, created: false }
    const r = this.stmt('INSERT INTO folders(path, added_at) VALUES (?, ?)').run(path, Date.now())
    return { id: Number(r.lastInsertRowid), created: true }
  }

  removeFolder(id: number): void {
    this.stmt('DELETE FROM folders WHERE id = ?').run(id)
  }

  markScanned(id: number): void {
    this.stmt('UPDATE folders SET last_scan = ? WHERE id = ?').run(Date.now(), id)
  }

  // ---- tracks ----
  /** path -> {size, mtime} for change detection during incremental scans. */
  knownFiles(folderId: number): Map<string, { id: string; size: number; mtime: number; available: number }> {
    const rows = this.stmt('SELECT id, path, size, mtime, available FROM tracks WHERE folder_id = ?').all(folderId) as {
      id: string
      path: string
      size: number
      mtime: number
      available: number
    }[]
    return new Map(rows.map((r) => [r.path, { id: r.id, size: r.size, mtime: r.mtime, available: r.available }]))
  }

  upsertTrack(t: TrackInput): void {
    this.stmt(
      `INSERT INTO tracks(id, folder_id, path, size, mtime, title, artist, artists_json, album, genre, year, track_no, duration_ms, art, added_at, available)
       VALUES (@id, @folder_id, @path, @size, @mtime, @title, @artist, @artists_json, @album, @genre, @year, @track_no, @duration_ms, @art, @added_at, 1)
       ON CONFLICT(id) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, title=excluded.title, artist=excluded.artist,
         artists_json=excluded.artists_json, album=excluded.album, genre=excluded.genre, year=excluded.year,
         track_no=excluded.track_no, duration_ms=excluded.duration_ms, art=excluded.art, available=1`
    ).run({ ...t, added_at: Date.now() } as unknown as Record<string, never>)
  }

  markMissing(ids: string[]): void {
    const s = this.stmt('UPDATE tracks SET available = 0 WHERE id = ?')
    for (const id of ids) s.run(id)
  }

  relinkTrack(id: string, path: string, folderId: number): void {
    this.stmt('UPDATE tracks SET path = ?, folder_id = ?, available = 1 WHERE id = ?').run(path, folderId, id)
  }

  getTrack(id: string): TrackRow | undefined {
    return this.stmt('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined
  }

  pathOf(id: string): string | undefined {
    return (this.stmt('SELECT path FROM tracks WHERE id = ?').get(id) as { path: string } | undefined)?.path
  }

  all(limit: number): TrackRow[] {
    return this.stmt('SELECT * FROM tracks ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_no, title COLLATE NOCASE LIMIT ?').all(
      limit
    ) as unknown as TrackRow[]
  }

  search(q: string, limit: number): TrackRow[] {
    const match = ftsQuery(q)
    if (!match) return []
    return this.stmt(
      `SELECT t.* FROM tracks_fts f JOIN tracks t ON t.rowid = f.rowid WHERE tracks_fts MATCH ? ORDER BY bm25(tracks_fts, 10, 5, 3, 1) LIMIT ?`
    ).all(match, limit) as unknown as TrackRow[]
  }

  // ---- kv ----
  kvGetAll(): Record<string, string> {
    const rows = this.stmt('SELECT key, value FROM kv').all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  kvSet(key: string, value: string): void {
    this.stmt('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  close(): void {
    this.db.close()
  }
}
