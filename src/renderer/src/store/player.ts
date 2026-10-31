import { create } from 'zustand'
import type { StreamSource } from '@shared/provider'
import type { Track } from '@shared/types'
import { backend } from '@/lib/backend'
import { sources } from '@/lib/sources'
import { load, save } from '@/lib/persist'
import { startKeepAlive, stopKeepAlive } from '@/lib/keepAlive'
import { offlineUrl } from '@/lib/offline'
import { pingPlay } from '@/lib/trending'
import { ytEmbed } from '@/lib/ytEmbed'
import { useLibrary } from './library'

export type Repeat = 'off' | 'all' | 'one'

interface PlayerState {
  queue: Track[]
  index: number
  playing: boolean
  loading: boolean
  error: string | null
  positionMs: number
  durationMs: number
  volume: number
  shuffle: boolean
  repeat: Repeat
  current: () => Track | null
  playTracks: (tracks: Track[], startIndex?: number) => void
  playIndex: (i: number) => void
  retryCurrent: () => void
  togglePlay: () => void
  next: (auto?: boolean) => void
  prev: () => void
  seek: (ms: number) => void
  setVolume: (v: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  enqueue: (t: Track) => void
  playNext: (t: Track) => void
  removeFromQueue: (i: number) => void
  clearQueue: () => void
}

const audio = new Audio()
audio.preload = 'auto'
// Desktop media (vega-media://) is served with CORS headers, which lets the equalizer's Web Audio graph read the stream.
if (window.vega) audio.crossOrigin = 'anonymous'

/** The single playback element (the equalizer attaches its Web Audio graph to it). */
export const getAudio = (): HTMLAudioElement => audio

/** Tracks what the user actually heard of the current track, for the analytics log. */
let session: { track: Track; startedAt: number; listenedMs: number; lastTick: number | null } | null = null

function finishSession(skipped: boolean): void {
  if (!session) return
  const { track, startedAt, listenedMs } = session
  session = null
  if (listenedMs < 1500) return // ignore accidental clicks
  const counted = listenedMs >= Math.min(30_000, track.durationMs * 0.5)
  useLibrary.getState().logPlay({ track, startedAt, listenedMs, counted, skipped: skipped && !counted })
  if (counted) pingPlay(track)
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

let loadToken = 0
let savedUrl: string | null = null
let wantPlay = false
let embedTimer: ReturnType<typeof setInterval> | null = null

/** Live playback position in ms (the store value only updates on timeupdate, ~4 Hz). */
export const getPosition = (): number => curTime() * 1000

/** True while the current track plays in YouTube's embedded player (web) instead of the audio element. */
let embedActive = false
const curTime = (): number => (embedActive ? ytEmbed.time() : audio.currentTime)
const setTime = (sec: number): void => {
  if (embedActive) ytEmbed.seek(sec)
  else audio.currentTime = sec
}

export const usePlayer = create<PlayerState>((set, get) => {
  const startCurrent = async (): Promise<void> => {
    const track = get().queue[get().index]
    if (!track) return
    const token = ++loadToken
    set({ loading: true, error: null, positionMs: 0, durationMs: track.durationMs })
    try {
      const saved = await offlineUrl(track).catch(() => null)
      if (savedUrl) URL.revokeObjectURL(savedUrl)
      savedUrl = saved
      const stream: StreamSource = saved ? { kind: 'url', url: saved } : (await sources.resolve(track, get().queue)).stream
      if (token !== loadToken) return
      if (stream.kind === 'embed') {
        audio.pause()
        audio.removeAttribute('src')
        embedActive = true
        wantPlay = true
        startKeepAlive()
        await ytEmbed.load(stream.videoId)
        if (token !== loadToken) return
        ytEmbed.setVolume(get().volume)
        embedTimer ??= setInterval(tick, 250)
      } else {
        if (stream.kind !== 'url') throw new Error('file streams need the stream proxy (M2)')
        if (embedActive) {
          embedActive = false
          ytEmbed.stop()
          stopKeepAlive()
          if (embedTimer) clearInterval(embedTimer)
          embedTimer = null
        }
        audio.src = backend.proxyStream?.(stream.url) ?? stream.url
        await audio.play()
        if (token !== loadToken) return
      }
      session = { track, startedAt: Date.now(), listenedMs: 0, lastTick: null }
      set({ loading: false, playing: true })
      // resolve the next track in the background so skipping is instant
      const nextTrack = get().queue[get().index + 1]
      if (nextTrack) sources.warm(nextTrack)
      updateMediaSession(track)
    } catch (err) {
      if (token !== loadToken) return
      console.warn('playback failed', err)
      set({ loading: false, playing: false, error: err instanceof Error ? err.message : `Couldn't play "${track.title}". Check the connection and retry.` })
      // skip forward after a failure so a dead track doesn't stall the queue
      if (get().queue.length > 1) setTimeout(() => token === loadToken && get().next(true), 1200)
    }
  }

  const tick = (): void => {
    const now = performance.now()
    if (session) {
      if (session.lastTick !== null) session.listenedMs += Math.min(1000, now - session.lastTick)
      session.lastTick = now
    }
    set({ positionMs: curTime() * 1000 })
    if (embedActive) {
      const d = ytEmbed.duration()
      if (d > 0 && Math.abs(d * 1000 - get().durationMs) > 1500) set({ durationMs: d * 1000 })
    }
  }
  audio.addEventListener('timeupdate', () => {
    if (!embedActive) tick()
  })
  ytEmbed.setHandlers({
    state: (s) => {
      if (!embedActive) return
      if (s === 'playing') set({ playing: true, loading: false })
      else if (s === 'paused') {
        // the browser pauses embeds when the tab is hidden (screen off, app switch): resume unless the user paused
        if (document.hidden && wantPlay) {
          ytEmbed.play()
          return
        }
        if (session) session.lastTick = null
        set({ playing: false })
      } else if (s === 'ended') {
        finishSession(false)
        get().next(true)
      }
    },
    error: () => {
      if (!embedActive) return
      const track = get().queue[get().index]
      if (!track) return
      const token = loadToken
      set({ loading: false, playing: false, error: `Couldn't play "${track.title}" from YouTube Music. Retry playback or choose another source.` })
      if (get().queue.length > 1) setTimeout(() => token === loadToken && get().next(true), 1200)
    }
  })
  audio.addEventListener('pause', () => {
    if (session) session.lastTick = null
    set({ playing: false })
  })
  audio.addEventListener('play', () => set({ playing: true }))
  audio.addEventListener('durationchange', () => {
    if (Number.isFinite(audio.duration)) set({ durationMs: audio.duration * 1000 })
  })
  audio.addEventListener('error', () => {
    // stream died after resolve (expired url, offline, bad file): report and move on
    const track = get().queue[get().index]
    if (!track || !audio.src) return
    const token = loadToken
    set({ loading: false, playing: false, error: `Couldn't play "${track.title}". The stream may have expired or the source is offline. Retry playback.` })
    if (get().queue.length > 1) setTimeout(() => token === loadToken && get().next(true), 1200)
  })
  audio.addEventListener('ended', () => {
    finishSession(false)
    get().next(true)
  })

  audio.volume = load<number>('volume', 0.8)

  return {
    queue: [],
    index: -1,
    playing: false,
    loading: false,
    error: null,
    positionMs: 0,
    durationMs: 0,
    volume: audio.volume,
    shuffle: false,
    repeat: 'off',

    current: () => get().queue[get().index] ?? null,

    playTracks: (tracks, startIndex = 0) => {
      if (!tracks.length) return
      finishSession(true)
      let queue = tracks
      let index = startIndex
      if (get().shuffle) {
        const first = tracks[startIndex]!
        queue = [first, ...shuffled(tracks.filter((_, i) => i !== startIndex))]
        index = 0
      }
      set({ queue, index })
      void startCurrent()
    },

    playIndex: (i) => {
      if (i < 0 || i >= get().queue.length) return
      finishSession(true)
      set({ index: i })
      void startCurrent()
    },

    retryCurrent: () => {
      if (get().index < 0) return
      finishSession(true)
      void startCurrent()
    },

    togglePlay: () => {
      if (embedActive && get().index >= 0) {
        wantPlay = !get().playing
        if (get().playing) {
          ytEmbed.pause()
          stopKeepAlive()
        } else {
          ytEmbed.play()
          startKeepAlive()
        }
      } else if (audio.src && !audio.ended && get().index >= 0) {
        if (audio.paused) void audio.play()
        else audio.pause()
      } else if (get().queue.length) {
        get().playIndex(Math.max(0, get().index))
      }
    },

    next: (auto = false) => {
      const { queue, index, repeat } = get()
      if (!queue.length) return
      if (auto && repeat === 'one') {
        set({ index })
        void startCurrent()
        return
      }
      const last = index >= queue.length - 1
      if (last && repeat !== 'all') {
        if (!auto) return
        audio.pause()
        if (embedActive) {
          wantPlay = false
          stopKeepAlive()
          ytEmbed.pause()
          ytEmbed.seek(0)
        } else audio.currentTime = 0
        set({ playing: false, positionMs: 0 })
        return
      }
      if (!auto) finishSession(true)
      set({ index: last ? 0 : index + 1 })
      void startCurrent()
    },

    prev: () => {
      if (curTime() > 3 || get().index <= 0) {
        setTime(0)
        return
      }
      finishSession(true)
      set({ index: get().index - 1 })
      void startCurrent()
    },

    seek: (ms) => {
      setTime(ms / 1000)
      set({ positionMs: ms })
    },

    setVolume: (v) => {
      audio.volume = v
      ytEmbed.setVolume(v)
      set({ volume: v })
      save('volume', v)
    },

    toggleShuffle: () => {
      const { shuffle, queue, index } = get()
      if (!shuffle && queue.length > 2) {
        const upcoming = shuffled(queue.slice(index + 1))
        set({ queue: [...queue.slice(0, index + 1), ...upcoming] })
      }
      set({ shuffle: !shuffle })
    },

    cycleRepeat: () => set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),

    enqueue: (t) => {
      if (!get().queue.length) return get().playTracks([t])
      set((s) => ({ queue: [...s.queue, t] }))
    },

    playNext: (t) => {
      if (!get().queue.length) return get().playTracks([t])
      set((s) => ({ queue: [...s.queue.slice(0, s.index + 1), t, ...s.queue.slice(s.index + 1)] }))
    },

    removeFromQueue: (i) => {
      const { queue, index } = get()
      if (i === index) return
      set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index })
    },

    clearQueue: () => {
      const cur = get().queue[get().index]
      set({ queue: cur ? [cur] : [], index: cur ? 0 : -1 })
    }
  }
})

function updateMediaSession(t: Track): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artists.join(', '), album: t.album ?? '', artwork: t.artworkUrl ? [{ src: t.artworkUrl, sizes: '544x544' }] : [] })
  const p = usePlayer.getState()
  navigator.mediaSession.setActionHandler('play', () => !usePlayer.getState().playing && p.togglePlay())
  navigator.mediaSession.setActionHandler('pause', () => usePlayer.getState().playing && p.togglePlay())
  navigator.mediaSession.setActionHandler('nexttrack', () => usePlayer.getState().next())
  navigator.mediaSession.setActionHandler('previoustrack', () => usePlayer.getState().prev())
}

