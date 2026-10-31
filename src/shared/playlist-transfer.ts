import { refKey, type Playlist, type Track } from './types'

export interface ImportedEntry {
  track?: Track
  title: string
  artists: string[]
  uri?: string
}

export interface ParsedPlaylist {
  name?: string
  entries: ImportedEntry[]
}

interface PlaylistJson {
  format: 'vega-playlist'
  version: 1
  name: string
  tracks: Track[]
}

const normalize = (value: string): string =>
  value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false
  const track = value as Partial<Track>
  return !!track.ref && typeof track.ref.source === 'string' && !!track.ref.source &&
    typeof track.ref.id === 'string' && !!track.ref.id &&
    typeof track.title === 'string' && Array.isArray(track.artists) &&
    track.artists.every((artist) => typeof artist === 'string') &&
    typeof track.durationMs === 'number' && Number.isFinite(track.durationMs) && track.durationMs >= 0
}

function parseJsonPlaylist(raw: string): ParsedPlaylist {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('The JSON file is not valid JSON.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The JSON file must contain a playlist object.')
  }
  const value = data as { format?: unknown; version?: unknown; name?: unknown; tracks?: unknown; playlist?: unknown }
  const nested = value.playlist && typeof value.playlist === 'object' && !Array.isArray(value.playlist)
    ? value.playlist as typeof value
    : value
  if (nested.format !== undefined && nested.format !== 'vega-playlist') {
    throw new Error('This JSON file uses an unsupported playlist format.')
  }
  if (nested.version !== undefined && nested.version !== 1) {
    throw new Error('This JSON playlist version is not supported.')
  }
  if (!Array.isArray(nested.tracks)) throw new Error('The JSON file does not contain a tracks array.')
  if (!nested.tracks.every(isTrack)) throw new Error('The JSON playlist contains an invalid track entry.')
  return {
    name: typeof nested.name === 'string' ? nested.name : undefined,
    entries: nested.tracks.map((track) => ({
      track,
      title: track.title,
      artists: track.artists,
      uri: `vega-track://${encodeURIComponent(track.ref.source)}/${encodeURIComponent(track.ref.id)}`
    }))
  }
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseM3uPlaylist(raw: string): ParsedPlaylist {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (!lines.some((line) => line.trim().toUpperCase() === '#EXTM3U')) {
    throw new Error('This is not a valid M3U8 playlist (missing #EXTM3U header).')
  }
  const entries: ImportedEntry[] = []
  let metadata: { title: string; artists: string[] } | undefined
  for (const line of lines) {
    const value = line.trim()
    if (!value) continue
    if (value.startsWith('#EXTINF:')) {
      const comma = value.indexOf(',')
      const label = comma >= 0 ? value.slice(comma + 1).trim() : ''
      const separator = label.indexOf(' - ')
      metadata = separator > 0
        ? { artists: label.slice(0, separator).split(',').map((artist) => artist.trim()).filter(Boolean), title: label.slice(separator + 3).trim() }
        : { artists: [], title: label }
    } else if (value.startsWith('#')) {
      continue
    } else {
      const pathName = decodePath(value.split(/[\\/]/).pop() ?? value).replace(/\.[^.]+$/, '')
      entries.push({
        title: metadata?.title || pathName || value,
        artists: metadata?.artists ?? [],
        uri: value
      })
      metadata = undefined
    }
  }
  if (!entries.length) throw new Error('The M3U8 playlist does not contain any tracks.')
  return { entries }
}

export function parsePlaylistFile(raw: string, filename: string): ParsedPlaylist {
  const extension = filename.toLowerCase().split('.').pop()
  if (extension === 'json') return parseJsonPlaylist(raw)
  if (extension === 'm3u' || extension === 'm3u8') return parseM3uPlaylist(raw)
  throw new Error('Choose a supported .m3u8 or .json playlist file.')
}

export function serializePlaylistJson(playlist: Playlist): string {
  const data: PlaylistJson = { format: 'vega-playlist', version: 1, name: playlist.name, tracks: playlist.tracks }
  return JSON.stringify(data, null, 2)
}

export function serializePlaylistM3u8(playlist: Playlist): string {
  return ['#EXTM3U', ...playlist.tracks.flatMap((track) => [
    `#EXTINF:${Math.max(0, Math.round(track.durationMs / 1000))},${track.artists.join(', ')} - ${track.title}`,
    `vega-track://${encodeURIComponent(track.ref.source)}/${encodeURIComponent(track.ref.id)}`
  ])].join('\n')
}

export function safePlaylistFilename(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').slice(0, 100) || 'playlist'
}

export function matchImportedTracks(entries: ImportedEntry[], available: Track[]): { tracks: Track[]; unmatched: number } {
  const byRef = new Map(available.map((track) => [refKey(track.ref), track]))
  const byMetadata = new Map<string, Track>()
  for (const track of available) {
    const key = `${normalize(track.title)}|${normalize(track.artists.join(' '))}`
    if (!byMetadata.has(key)) byMetadata.set(key, track)
  }
  const tracks: Track[] = []
  let unmatched = 0
  for (const entry of entries) {
    let track = entry.track ? byRef.get(refKey(entry.track.ref)) : undefined
    if (!track && entry.uri?.startsWith('vega-track://')) {
      const match = entry.uri.match(/^vega-track:\/\/([^/]+)\/(.+)$/i)
      if (match) {
        track = byRef.get(refKey({
          source: decodePath(match[1]!),
          id: decodePath(match[2]!)
        }))
      }
    }
    if (!track) {
      const key = `${normalize(entry.title)}|${normalize(entry.artists.join(' '))}`
      track = byMetadata.get(key) ?? [...byMetadata.values()].find((candidate) => normalize(candidate.title) === normalize(entry.title))
    }
    if (!track) {
      unmatched++
      continue
    }
    tracks.push(track)
  }
  return { tracks, unmatched }
}
