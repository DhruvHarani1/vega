import { useEffect, useRef, useState } from 'react'
import { refKey, type Track } from '@shared/types'
import { fmtTime } from '@/lib/format'
import { backend } from '@/lib/backend'
import { useCatalog } from '@/store/catalog'
import { canSaveOffline, isSavedOffline, removeOffline, saveOffline } from '@/lib/offline'
import { radioFrom } from '@/lib/recommender'
import { warmOnHover } from '@/lib/sources'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUi } from '@/store/ui'
import { Cover } from './Cover'
import { Icon } from './Icon'

const SOURCE_LABEL: Record<string, string> = { audius: 'Audius', jamendo: 'Jamendo', archive: 'Archive', radio: 'Radio', local: 'Local', ytm: 'YT Music' }

interface Props {
  track: Track
  index?: number
  onPlay: () => void
  /** Extra actions shown in the menu (e.g. "Remove from playlist"). */
  extra?: { label: string; run: () => void }[]
}

export function TrackRow({ track, index, onPlay, extra }: Props) {
  const key = refKey(track.ref)
  const active = usePlayer((s) => {
    const c = s.queue[s.index]
    return !!c && refKey(c.ref) === key
  })
  const playing = usePlayer((s) => s.playing)
  const liked = useLibrary((s) => s.liked.some((x) => refKey(x.ref) === key))
  const toggleLike = useLibrary((s) => s.toggleLike)
  const [menu, setMenu] = useState(false)
  const [available, setAvailable] = useState(track.available)
  useEffect(() => {
    if (track.ref.source !== 'local') return
    void backend.getTrack(track.ref.id).then((current) => setAvailable(current?.available ?? false))
  }, [track.ref.id, track.ref.source])
  const live = track.durationMs === 0

  return (
    <div className={`row${active ? ' active' : ''}`} onDoubleClick={onPlay} {...warmOnHover(track)}>
      <button className="row-idx" onClick={onPlay} aria-label={`Play ${track.title}`}>
        {active && playing ? <span className="eq" /> : <span className="num">{index !== undefined ? index + 1 : ''}</span>}
        <span className="hover-play">
          <Icon name="play" size={15} />
        </span>
      </button>
      <Cover track={track} size={44} radius={10} />
      <div className="row-main">
        <div className="row-title">{track.title}</div>
        <div className="row-sub">
          {available === false && <span className="err">File unavailable · </span>}
          {SOURCE_LABEL[track.ref.source] && <span className={`src src-${track.ref.source}`}>{SOURCE_LABEL[track.ref.source]}</span>}
          {track.artists.join(', ')}
        </div>
      </div>
      <div className="row-album">{track.album}</div>
      <button className={`icon-btn like${liked ? ' on' : ''}`} onClick={() => toggleLike(track)} aria-label={liked ? 'Unlike' : 'Like'}>
        <Icon name={liked ? 'heart-fill' : 'heart'} size={17} />
      </button>
      <div className="row-time">{live ? <span className="badge-live sm">LIVE</span> : fmtTime(track.durationMs)}</div>
      <div className="row-menu-wrap">
        <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="More options">
          <Icon name="more" size={18} />
        </button>
        {menu && <TrackMenu track={track} available={available} onRelink={() => setAvailable(true)} extra={extra} close={() => setMenu(false)} />}
      </div>
    </div>
  )
}

function TrackMenu({ track, available, onRelink, extra, close }: { track: Track; available?: boolean; onRelink: () => void; extra?: Props['extra']; close: () => void }) {
  const playlists = useLibrary((s) => s.playlists)
  const addToPlaylist = useLibrary((s) => s.addToPlaylist)
  const createPlaylist = useLibrary((s) => s.createPlaylist)
  const toast = useUi((s) => s.toast)
  const refreshCatalog = useCatalog((s) => s.refresh)
  const { playNext, enqueue } = usePlayer.getState()
  const ref = useRef<HTMLDivElement>(null)
  const [saved, setSaved] = useState<boolean | null>(null)
  const offlineOk = canSaveOffline(track)

  useEffect(() => {
    if (offlineOk) void isSavedOffline(track).then(setSaved)
  }, [offlineOk, track])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    // flip upward when there is no room below
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      if (r.bottom > window.innerHeight - 110) el.classList.add('up')
    }
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const item = (label: string, icon: string, run: () => void) => (
    <button
      className="menu-item"
      onClick={() => {
        run()
        close()
      }}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  )

  return (
    <>
      <div className="menu-scrim" onClick={close} />
      <div className="menu" ref={ref}>
        {track.ref.source === 'local' && available === false && backend.relinkTrack && item('Locate missing file…', 'folder', () => {
          void backend.relinkTrack!(track.ref.id).then((relinked) => {
            if (relinked) {
              onRelink()
              toast('File reconnected.', 'ok')
              void refreshCatalog()
            }
          }).catch((error: Error) => toast(error.message, 'error'))
        })}
        {item('Play next', 'play', () => {
          playNext(track)
          toast('Playing next', 'ok')
        })}
        {item('Add to queue', 'queue', () => {
          enqueue(track)
          toast('Added to queue', 'ok')
        })}
        {item('Start radio', 'radio', () => {
          toast('Building your radio…')
          void radioFrom(track).then((t) => usePlayer.getState().playTracks(t))
        })}
        {offlineOk &&
          saved !== null &&
          item(saved ? 'Remove offline copy' : 'Save for offline', 'download', () => {
            if (saved) void removeOffline(track).then(() => toast('Removed offline copy'))
            else {
              toast('Saving…')
              void saveOffline(track).then(
                () => toast('Saved for offline', 'ok'),
                (e: Error) => toast(e.message, 'error')
              )
            }
          })}
        <div className="menu-sep">Add to playlist</div>
        {playlists.map((p) =>
          item(p.name, 'plus', () => {
            addToPlaylist(p.id, track)
            toast(`Added to ${p.name}`, 'ok')
          })
        )}
        {item('New playlist', 'spark', () => {
          createPlaylist(track.title, [track])
          toast('Playlist created', 'ok')
        })}
        {extra && <div className="menu-sep">This list</div>}
        {extra?.map((e) => item(e.label, 'chevron-right', e.run))}
      </div>
    </>
  )
}
