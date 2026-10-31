import { useCallback, useEffect, useState } from 'react'
import type { FolderInfo, ScanProgress } from '@shared/library'
import type { Health } from '@shared/provider'
import { backend } from '@/lib/backend'
import { sources } from '@/lib/sources'
import { useCatalog } from '@/store/catalog'
import { useMeta } from '@/store/meta'
import { useOnline } from '@/store/online'

function ago(ts: number | null): string {
  if (!ts) return 'never scanned'
  const m = Math.round((Date.now() - ts) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

function fmtBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 / 1024).toFixed(0)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`
}

function SourceHealthPanel() {
  const [health, setHealth] = useState<Record<string, Health>>({})
  const [checking, setChecking] = useState(false)
  const check = useCallback(async () => {
    setChecking(true)
    setHealth(await sources.health())
    setChecking(false)
  }, [])
  useEffect(() => { void check() }, [check])
  return (
    <>
      <div className="shelf-head">
        <h2 className="section">Source status</h2>
        <button className="pill ghost" disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <div className="panel">
        {sources.list().map((source) => {
          const status = health[source.id]
          return (
            <div className="toggle-row" key={source.id}>
              <div className="row-title">{source.name}</div>
              <span className={status === 'ok' ? 'ok' : status === 'down' ? 'err' : 'muted'}>
                {status === 'ok' ? 'Available' : status === 'degraded' ? 'Degraded' : status === 'down' ? 'Unavailable' : 'Checking…'}
              </span>
            </div>
          )
        })}
        {!sources.list().length && <div className="row-sub">No sources are enabled.</div>}
      </div>
    </>
  )
}

function YoutubePanel() {
  const api = window.vega?.ytdlp
  const online = useOnline()
  const [status, setStatus] = useState<{ installed: boolean; version?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const refresh = useCallback(() => void api?.status().then(setStatus), [api])
  useEffect(refresh, [refresh])
  if (!api) return null
  return (
    <>
      <div className="panel toggle-row">
        <div className="grow">
          <div className="row-title">YouTube Music</div>
          <div className="row-sub">The main catalogue: Hindi, Punjabi, Tamil, Telugu and international songs. Fast search, built in.</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={online.ytm} onChange={(e) => online.setYtm(e.target.checked)} />
          <span />
        </label>
      </div>
      <div className="panel toggle-row">
        <div className="grow">
          <div className="row-title">Playback engine (yt-dlp)</div>
          <div className="row-sub">
            {status?.installed ? `Included with Vega · version ${status.version}.` : 'Not found.'} Update it if YouTube playback stops working.
            {msg && <span className={msg.startsWith('Updated') ? 'ok' : 'err'}> {msg}</span>}
          </div>
        </div>
        <button
          className="pill ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setMsg(null)
            const r = await api.install()
            setMsg(r.ok ? 'Updated.' : (r.error ?? 'Update failed'))
            setBusy(false)
            refresh()
          }}
        >
          {busy ? 'Updating…' : 'Update'}
        </button>
      </div>
    </>
  )
}

function CachePanel() {
  const api = window.vega?.cache
  const [stats, setStats] = useState<{ bytes: number; files: number; maxBytes: number } | null>(null)
  const refresh = useCallback(() => void api?.stats().then(setStats), [api])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [refresh])
  if (!api || !stats) return null
  return (
    <div className="panel toggle-row">
      <div className="grow">
        <div className="row-title">Offline cache</div>
        <div className="row-sub">
          Songs you stream are saved here so they replay instantly and work offline. {stats.files} songs · {fmtBytes(stats.bytes)} of {fmtBytes(stats.maxBytes)}
        </div>
      </div>
      <select
        className="key-input narrow-select"
        value={Math.round(stats.maxBytes / 1024 / 1024)}
        onChange={(e) => void api.setMaxMb(Number(e.target.value)).then(refresh)}
        aria-label="Cache size limit"
      >
        {[512, 1024, 2048, 5120, 10240].map((mb) => (
          <option key={mb} value={mb}>
            {fmtBytes(mb * 1024 * 1024)}
          </option>
        ))}
      </select>
      <button className="pill ghost" onClick={() => void api.clear().then(refresh)}>
        Clear
      </button>
    </div>
  )
}

export function Sources() {
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [progress, setProgress] = useState<Record<string, ScanProgress>>({})
  const { demo, setDemo, localCount, refresh } = useCatalog()
  const online = useOnline()
  const [keyDraft, setKeyDraft] = useState(online.jamendoClientId)
  const meta = useMeta()
  const [lfDraft, setLfDraft] = useState(meta.lastfmKey)

  const reload = useCallback(async () => {
    setFolders(await backend.folders())
    void refresh()
  }, [refresh])

  useEffect(() => {
    void reload()
    return backend.onScanProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.folderId]: p }))
      if (p.phase === 'done' || p.phase === 'error') void reload()
    })
  }, [reload])

  const onlineSection = (
    <>
      <h2 className="section">Online sources</h2>
      <div className="panel toggle-row">
        <div>
          <div className="row-title">Audius</div>
          <div className="row-sub">Independent artists, millions of tracks. No account or key needed.</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={online.audius} onChange={(e) => online.setAudius(e.target.checked)} />
          <span />
        </label>
      </div>
      <div className="panel toggle-row">
        <div>
          <div className="row-title">Internet Archive</div>
          <div className="row-sub">Netlabels, 78rpm records, live recordings and open audio. No account or key needed.</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={online.archive} onChange={(e) => online.setArchive(e.target.checked)} />
          <span />
        </label>
      </div>
      <div className="panel toggle-row">
        <div>
          <div className="row-title">Live radio</div>
          <div className="row-sub">Thousands of internet radio stations (radio-browser.info). No account or key needed.</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={online.radio} onChange={(e) => online.setRadio(e.target.checked)} />
          <span />
        </label>
      </div>
      <div className="panel toggle-row">
        <div className="grow">
          <div className="row-title">Jamendo</div>
          <div className="row-sub">
            Creative-Commons music. Needs a free client ID from{' '}
            <a href="https://devportal.jamendo.com" target="_blank" rel="noreferrer">
              devportal.jamendo.com
            </a>
            .
          </div>
        </div>
        <input
          className="key-input"
          placeholder="Client ID"
          value={keyDraft}
          spellCheck={false}
          onChange={(e) => setKeyDraft(e.target.value)}
          onBlur={() => online.setJamendoClientId(keyDraft)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
    </>
  )

  if (!backend.supported) {
    return (
      <div className="page-pad">
        <h1 className="display">Music <em>sources</em></h1>
        <div className="banner">
          This browser cannot open local folders. Use Chrome, Edge or the Vega desktop app to add your own music. Online sources work everywhere.
        </div>
        <SourceHealthPanel />
        {onlineSection}
      </div>
    )
  }

  return (
    <div className="page-pad">
      <div className="shelf-head">
        <div>
          <h1 className="display">Music <em>sources</em></h1>
          <div className="muted">
            {backend.kind === 'web' ? 'Files stay on your computer; the browser reads them directly.' : 'Folders are scanned into a local database.'}{' '}
            {localCount} tracks in your library.
          </div>
        </div>
        <div className="actions">
          {folders.length > 0 && (
            <button className="pill ghost" onClick={() => void backend.rescan()}>
              Rescan all
            </button>
          )}
          <button
            className="pill big"
            onClick={async () => {
              await backend.addFolder()
              void reload()
            }}
          >
            Add music folder
          </button>
        </div>
      </div>

      {!folders.length && <div className="banner">No folders yet. Add the folder where your music lives (mp3, flac, m4a, ogg, opus, wav).</div>}

      <div className="panel">
        {folders.map((f) => {
          const p = progress[f.id]
          const busy = p && (p.phase === 'walking' || p.phase === 'reading')
          return (
            <div className="folder" key={f.id}>
              <div className="row-main">
                <div className="row-title">{f.path}</div>
                <div className="row-sub">
                  {f.trackCount} tracks · {busy ? (p.phase === 'walking' ? `finding files… ${p.total || ''}` : `reading tags ${p.scanned}/${p.total}`) : ago(f.lastScan)}
                  {p?.phase === 'error' && <span className="err"> · {p.message}</span>}
                </div>
                {busy && p.phase === 'reading' && (
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${p.total ? (p.scanned / p.total) * 100 : 0}%` }} />
                  </div>
                )}
              </div>
              {f.needsPermission && (
                <button
                  className="pill"
                  onClick={async () => {
                    await backend.grantAccess?.(f.id)
                    void reload()
                  }}
                >
                  Reconnect
                </button>
              )}
              <button className="pill ghost" disabled={!!busy} onClick={() => void backend.rescan(f.id)}>
                Rescan
              </button>
              <button
                className="pill ghost"
                onClick={async () => {
                  await backend.removeFolder(f.id)
                  void reload()
                }}
              >
                Remove
              </button>
            </div>
          )
        })}
      </div>

      <SourceHealthPanel />
      {onlineSection}
      <h2 className="section">Smarter recommendations</h2>
      <div className="panel toggle-row">
        <div>
          <div className="row-title">Learn genres (MusicBrainz)</div>
          <div className="row-sub">
            Looks up artist genres so songs without tags still get recommended and can fill smart playlists. Free, no key.
            {meta.pending > 0 && <span> Working through {meta.pending} artists…</span>}
          </div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={meta.enrich} onChange={(e) => meta.setEnrich(e.target.checked)} />
          <span />
        </label>
      </div>
      <div className="panel toggle-row">
        <div className="grow">
          <div className="row-title">Similar artists (Last.fm)</div>
          <div className="row-sub">
            Optional. Adds "similar to what you play" to recommendations and radio. Free API key from{' '}
            <a href="https://www.last.fm/api/account/create" target="_blank" rel="noreferrer">
              last.fm/api
            </a>
            .
          </div>
        </div>
        <input
          className="key-input"
          placeholder="API key"
          value={lfDraft}
          spellCheck={false}
          onChange={(e) => setLfDraft(e.target.value)}
          onBlur={() => meta.setLastfmKey(lfDraft)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      <YoutubePanel />
      <CachePanel />

      <div className="panel toggle-row">
        <div>
          <div className="row-title">Demo catalog</div>
          <div className="row-sub">Fictional songs with synthesized audio, handy for trying Vega before adding music.</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <span />
        </label>
      </div>
    </div>
  )
}
