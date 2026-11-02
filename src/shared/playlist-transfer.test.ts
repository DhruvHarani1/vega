import { describe, expect, it } from 'vitest'
import type { Playlist, Track } from './types'
import {
  matchImportedTracks,
  parsePlaylistFile,
  safePlaylistFilename,
  serializePlaylistJson,
  serializePlaylistM3u8
} from './playlist-transfer'

const first: Track = {
  ref: { source: 'audius', id: 'track/one' },
  title: 'Café Dreams',
  artists: ['The Example'],
  durationMs: 185_000,
  album: 'First Album'
}
const second: Track = {
  ref: { source: 'jamendo', id: 'two' },
  title: 'Night Drive',
  artists: ['Another Artist'],
  durationMs: 210_000
}
const playlist: Playlist = { id: 'p1', name: 'Road / Trip', createdAt: 1, tracks: [first, second] }

describe('playlist transfer', () => {
  it('round-trips JSON playlists and preserves track order and metadata', () => {
    const parsed = parsePlaylistFile(serializePlaylistJson(playlist), 'road-trip.json')
    const result = matchImportedTracks(parsed.entries, [second, first])
    expect(parsed.name).toBe(playlist.name)
    expect(result.tracks).toEqual([first, second])
    expect(result.unmatched).toBe(0)
  })

  it('imports embedded JSON tracks when the local library is empty', () => {
    const parsed = parsePlaylistFile(serializePlaylistJson(playlist), 'road-trip.json')
    const result = matchImportedTracks(parsed.entries, [])
    expect(result.tracks).toEqual([first, second])
    expect(result.unmatched).toBe(0)
  })

  it('round-trips M3U8 references with encoded source IDs and metadata', () => {
    const parsed = parsePlaylistFile(serializePlaylistM3u8(playlist), 'road-trip.m3u8')
    const result = matchImportedTracks(parsed.entries, [second, first])
    expect(result.tracks).toEqual([first, second])
    expect(result.unmatched).toBe(0)
  })

  it('matches ordinary M3U entries by title and artist and reports unmatched entries', () => {
    const parsed = parsePlaylistFile(
      '#EXTM3U\n#EXTINF:185,The Example - Cafe Dreams\n/c/music/cafe-dreams.mp3\n#EXTINF:120,Unknown - Missing\n/missing.mp3',
      'mix.m3u'
    )
    const result = matchImportedTracks(parsed.entries, [first])
    expect(result.tracks).toEqual([first])
    expect(result.unmatched).toBe(1)
  })

  it('rejects malformed JSON and unsupported playlist files', () => {
    expect(() => parsePlaylistFile('{broken', 'mix.json')).toThrow('not valid JSON')
    expect(() => parsePlaylistFile('#EXTM3U', 'mix.txt')).toThrow('supported')
  })

  it('rejects invalid track entries without returning a partial playlist', () => {
    const invalid = JSON.stringify({ format: 'vega-playlist', version: 1, tracks: [{ title: 'broken' }] })
    expect(() => parsePlaylistFile(invalid, 'mix.json')).toThrow('invalid track entry')
  })

  it('keeps repeated tracks in their original positions', () => {
    const parsed = parsePlaylistFile(serializePlaylistJson({ ...playlist, tracks: [first, second, first] }), 'repeat.json')
    const result = matchImportedTracks(parsed.entries, [first, second])
    expect(result.tracks).toEqual([first, second, first])
  })

  it('sanitizes exported filenames', () => {
    expect(safePlaylistFilename(' Road / Trip ')).toBe('Road - Trip')
    expect(safePlaylistFilename('  ')).toBe('playlist')
  })
})
