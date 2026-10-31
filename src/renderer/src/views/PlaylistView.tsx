import { useRef, useState } from 'react'
import { matchImportedTracks, parsePlaylistFile, safePlaylistFilename, serializePlaylistJson, serializePlaylistM3u8 } from '@shared/playlist-transfer'
import { Icon } from '@/components/Icon'
import { TrackList } from '@/components/TrackList'
import { fmtMinutes } from '@/lib/format'
import { useCatalog } from '@/store/catalog'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUi } from '@/store/ui'

export function PlaylistView({ id }: { id: string }) {
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id))
  const { renamePlaylist, deletePlaylist, removeFromPlaylist, moveInPlaylist, createPlaylist } = useLibrary.getState()
  const availableTracks = useCatalog((s) => s.tracks)
  const playTracks = usePlayer((s) => s.playTracks)
  const go = useUi((s) => s.go)
  const toast = useUi((s) => s.toast)
  const fileInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  if (!playlist) return <div className="page-pad muted">Playlist not found.</div>
  const mins = Math.round(playlist.tracks.reduce((n, t) => n + t.durationMs, 0) / 60_000)

  const exportPlaylist = (format: 'json' | 'm3u8'): void => {
    const filename = safePlaylistFilename(playlist.name)
    if (format === 'json') {
      downloadFile(`${filename}.json`, serializePlaylistJson(playlist), 'application/json;charset=utf-8')
      toast('Playlist exported as JSON', 'ok')
      return
    }
    downloadFile(`${filename}.m3u8`, serializePlaylistM3u8(playlist), 'audio/x-mpegurl;charset=utf-8')
    toast('Playlist exported as M3U8', 'ok')
  }

  const importPlaylist = async (file?: File): Promise<void> => {
    if (!file) return
    setImporting(true)
    try {
      const raw = await file.text()
      const parsed = parsePlaylistFile(raw, file.name)
      const library = useLibrary.getState()
      const available = [...availableTracks, ...library.playlists.flatMap((item) => item.tracks), ...library.liked]
      const result = matchImportedTracks(parsed.entries, available)
      if (!result.tracks.length) {
        throw new Error(`No tracks could be matched in this playlist (${result.unmatched} unmatched).`)
      }
      const importedName = safePlaylistFilename(parsed.name || file.name.replace(/\.(m3u8?|json)$/i, ''))
      createPlaylist(importedName, result.tracks)
      toast(`Imported ${result.tracks.length} tracks${result.unmatched ? `; ${result.unmatched} unmatched` : ''}`, 'ok')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not import this playlist.', 'error')
    } finally {
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="page-pad">
      <div className="hero-head">
        <div className="hero-art">
          <Icon name="library" size={56} />
        </div>
        <div>
          <div className="eyebrow">Playlist</div>
          {editing ? (
            <input
              className="title-input"
              autoFocus
              defaultValue={playlist.name}
              onBlur={(e) => {
                renamePlaylist(id, e.target.value)
                setEditing(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          ) : (
            <h1 onDoubleClick={() => setEditing(true)} title="Double-click to rename">
              {playlist.name}
            </h1>
          )}
          <div className="muted">
            {playlist.tracks.length} songs · {fmtMinutes(mins)}
          </div>
          <div className="actions">
            <button className="pill big" disabled={!playlist.tracks.length} onClick={() => playTracks(playlist.tracks)}>
              <Icon name="play" size={16} /> Play
            </button>
            <button className="pill ghost" onClick={() => exportPlaylist('m3u8')} disabled={!playlist.tracks.length}>
              <Icon name="download" size={16} /> Export M3U8
            </button>
            <button className="pill ghost" onClick={() => exportPlaylist('json')} disabled={!playlist.tracks.length}>
              <Icon name="download" size={16} /> Export JSON
            </button>
            <button className="pill ghost" onClick={() => fileInput.current?.click()} disabled={importing}>
              <Icon name="upload" size={16} /> {importing ? 'Importing…' : 'Import'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".m3u,.m3u8,.json,application/json,audio/x-mpegurl"
              hidden
              onChange={(event) => void importPlaylist(event.target.files?.[0])}
            />
            <button
              className="pill ghost"
              onClick={() => {
                deletePlaylist(id)
                go({ name: 'home' })
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
      {!playlist.tracks.length && <div className="muted pad">Empty. Use the ⋯ menu on any song to add it here.</div>}
      <TrackList
        tracks={playlist.tracks}
        extra={(i) => [
          { label: 'Move up', run: () => moveInPlaylist(id, i, i - 1) },
          { label: 'Move down', run: () => moveInPlaylist(id, i, i + 1) },
          { label: 'Remove from playlist', run: () => removeFromPlaylist(id, i) }
        ]}
      />
    </div>
  )
}
