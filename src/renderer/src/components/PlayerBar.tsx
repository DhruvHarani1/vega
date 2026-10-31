import { useState } from 'react'
import { refKey } from '@shared/types'
import { fmtTime } from '@/lib/format'
import { useLibrary } from '@/store/library'
import { usePlayer } from '@/store/player'
import { useUi } from '@/store/ui'
import { Cover } from './Cover'
import { Icon } from './Icon'

/** The floating player dock. */
export function PlayerBar() {
  const p = usePlayer()
  const track = p.queue[p.index]
  const liked = useLibrary((s) => !!track && s.liked.some((x) => refKey(x.ref) === refKey(track.ref)))
  const toggleLike = useLibrary((s) => s.toggleLike)
  const panel = useUi((s) => s.panel)
  const togglePanel = useUi((s) => s.togglePanel)
  const openNowPlaying = useUi((s) => s.openNowPlaying)
  const eqOpen = useUi((s) => s.eqOpen)
  const setEqOpen = useUi((s) => s.setEqOpen)
  const [premute, setPremute] = useState(0.8)
  const live = !!track && track.durationMs === 0
  const pct = p.durationMs && !live ? (p.positionMs / p.durationMs) * 100 : 0

  return (
    <footer className={`dock${track ? ' has-track' : ''}`}>
      <div className="dock-left">
        {track ? (
          <>
            <button className="dock-art" onClick={() => togglePanel('lyrics')} aria-label="Show lyrics" title="Show lyrics">
              <Cover track={track} size={60} radius={12} />
              <span className="dock-art-hover">
                <Icon name="lyrics" size={18} />
              </span>
            </button>
            <div className="dock-meta">
              <div className="row-title">{track.title}</div>
              <div className={`row-sub${p.error ? ' err' : ''}`}>{p.error ?? (p.loading ? 'Loading…' : track.artists.join(', '))}</div>
            </div>
            {p.error && (
              <button className="icon-btn" onClick={p.retryCurrent} aria-label="Retry playback" title="Retry playback">
                <Icon name="refresh-cw" size={17} />
              </button>
            )}
            <button className={`icon-btn like${liked ? ' on' : ''}`} onClick={() => toggleLike(track)} aria-label={liked ? 'Remove from liked' : 'Add to liked'}>
              <Icon name={liked ? 'heart-fill' : 'heart'} size={19} />
            </button>
          </>
        ) : (
          <div className="dock-idle">
            <span className="dock-idle-mark">
              <Icon name="spark" size={18} />
            </span>
            <span className="muted">Pick something to play</span>
          </div>
        )}
      </div>

      <div className="dock-center">
        <div className="transport">
          <button className={`icon-btn${p.shuffle ? ' on' : ''}`} onClick={p.toggleShuffle} aria-label="Shuffle" title="Shuffle">
            <Icon name="shuffle" size={18} />
          </button>
          <button className="icon-btn" onClick={p.prev} aria-label="Previous" disabled={!track}>
            <Icon name="prev" size={22} />
          </button>
          <button className="play-btn" onClick={p.togglePlay} aria-label={p.playing ? 'Pause' : 'Play'} disabled={!track}>
            <Icon name={p.playing ? 'pause' : 'play'} size={22} />
          </button>
          <button className="icon-btn" onClick={() => p.next()} aria-label="Next" disabled={!track}>
            <Icon name="next" size={22} />
          </button>
          <button className={`icon-btn${p.repeat !== 'off' ? ' on' : ''}`} onClick={p.cycleRepeat} aria-label={`Repeat ${p.repeat}`} title="Repeat">
            <Icon name={p.repeat === 'one' ? 'repeat-one' : 'repeat'} size={18} />
          </button>
        </div>
        <div className="seek">
          <span className="time">{fmtTime(p.positionMs)}</span>
          {live ? (
            <span className="live-bar">
              <i /> LIVE
            </span>
          ) : (
            <input
              type="range"
              className="slider"
              min={0}
              max={Math.max(1, p.durationMs)}
              value={p.positionMs}
              disabled={!track}
              style={{ ['--pct' as string]: `${pct}%` }}
              onChange={(e) => p.seek(Number(e.target.value))}
              aria-label="Seek"
            />
          )}
          <span className="time">{live ? '' : fmtTime(p.durationMs)}</span>
        </div>
      </div>

      <div className="dock-right">
        <button className={`icon-btn${panel === 'lyrics' ? ' on' : ''}`} onClick={() => togglePanel('lyrics')} aria-label="Lyrics" title="Lyrics (L)" disabled={!track}>
          <Icon name="lyrics" size={19} />
        </button>
        <button className={`icon-btn${panel === 'queue' ? ' on' : ''}`} onClick={() => togglePanel('queue')} aria-label="Queue" title="Queue">
          <Icon name="queue" size={19} />
        </button>
        <button className="icon-btn" onClick={openNowPlaying} aria-label="Fullscreen player" title="Fullscreen player" disabled={!track}>
          <Icon name="expand" size={19} />
        </button>
        {window.vega && (
          <button className={`icon-btn${eqOpen ? ' on' : ''}`} onClick={() => setEqOpen(!eqOpen)} aria-label="Equalizer" title="Equalizer">
            <Icon name="eq" size={19} />
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={p.volume === 0 ? 'Unmute' : 'Mute'}
          onClick={() => {
            if (p.volume > 0) {
              setPremute(p.volume)
              p.setVolume(0)
            } else p.setVolume(premute || 0.8)
          }}
        >
          <Icon name={p.volume === 0 ? 'volume-mute' : 'volume'} size={19} />
        </button>
        <input
          type="range"
          className="slider vol"
          min={0}
          max={1}
          step={0.01}
          value={p.volume}
          style={{ ['--pct' as string]: `${p.volume * 100}%` }}
          onChange={(e) => p.setVolume(Number(e.target.value))}
          aria-label="Volume"
        />
      </div>
    </footer>
  )
}
