/** Stable, provider-agnostic identity of a track. Persisted everywhere (library, playlists, history). */
export interface TrackRef {
  source: string
  id: string
}

export interface Track {
  ref: TrackRef
  title: string
  artists: string[]
  album?: string
  durationMs: number
  genres?: string[]
  year?: number
  isrc?: string
  mbid?: string
  /** Remote artwork. Absent => the UI draws a generated cover from the track key. */
  artworkUrl?: string
  /** False when a local library file is no longer present at its indexed path. */
  available?: boolean
}

export const refKey = (r: TrackRef): string => `${r.source}:${r.id}`

export const parseRefKey = (k: string): TrackRef => {
  const i = k.indexOf(':')
  return { source: k.slice(0, i), id: k.slice(i + 1) }
}

export interface Playlist {
  id: string
  name: string
  description?: string
  createdAt: number
  /** Last edit time (ms); drives cloud sync conflict resolution. */
  updatedAt?: number
  tracks: Track[]
}

/** One listening session of a track, appended to the analytics log. */
export interface PlayEvent {
  track: Track
  startedAt: number
  listenedMs: number
  /** Reached the scrobble threshold: 30 s or 50 % of the track. */
  counted: boolean
  skipped: boolean
}

// ---- Lyrics (ported from Lyra, shared/types.ts) ----

export interface LyricWord {
  timeMs: number
  text: string
}

export interface LyricLine {
  timeMs: number
  text: string
  /** Only present when the source supplied word-level timing. */
  words?: LyricWord[]
  /** When the last word ends (set for estimated timing so it does not stretch across a long gap). */
  endMs?: number
}

export type LyricsStatus = 'synced' | 'plain' | 'instrumental' | 'none' | 'error'

export interface LyricsResult {
  trackKey: string
  status: LyricsStatus
  provider: string
  lines: LyricLine[]
  plain?: string
  wordSynced?: boolean
  /** What the provider matched, so the UI can reveal wrong matches. */
  matched?: { title: string; artist: string; durationMs: number }
  error?: { kind: 'network' | 'rate-limit' | 'server' | 'unknown'; message: string; retryable: boolean }
}
