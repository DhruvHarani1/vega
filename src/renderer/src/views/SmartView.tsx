import { useMemo, useState } from 'react'
import { evaluateSmart, FIELD_KIND, FIELD_LABELS, type Condition, type Field, type Op, type SmartPlaylist } from '@shared/smart'
import { refKey } from '@shared/types'
import { Icon } from '@/components/Icon'
import { TrackList } from '@/components/TrackList'
import { fmtMinutes } from '@/lib/format'
import { buildUniverse } from '@/lib/recommender'
import { useCatalog } from '@/store/catalog'
import { useLibrary } from '@/store/library'
import { useMeta } from '@/store/meta'
import { usePlayer } from '@/store/player'
import { useUi } from '@/store/ui'

const OPS: Record<'text' | 'number' | 'bool', { op: Op; label: string }[]> = {
  text: [
    { op: 'contains', label: 'contains' },
    { op: 'is', label: 'is' }
  ],
  number: [
    { op: 'gt', label: 'greater than' },
    { op: 'lt', label: 'less than' },
    { op: 'is', label: 'equals' }
  ],
  bool: [{ op: 'is', label: 'is' }]
}

const EMPTY: Omit<SmartPlaylist, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'New smart playlist',
  match: 'all',
  conditions: [{ field: 'genre', op: 'contains', value: '' }],
  limit: 50,
  sort: 'plays'
}

const defaultValue = (f: Field): Condition['value'] => (FIELD_KIND[f] === 'number' ? 0 : FIELD_KIND[f] === 'bool' ? true : '')

export function SmartView({ id }: { id: string }) {
  const existing = useLibrary((s) => s.smart.find((p) => p.id === id))
  const events = useLibrary((s) => s.events)
  const liked = useLibrary((s) => s.liked)
  const likedSet = useMemo(() => new Set(liked.map((t) => refKey(t.ref))), [liked])
  const catalog = useCatalog((s) => s.tracks)
  const artistGenres = useMeta((s) => s.artistGenres)
  const genresFor = useMeta((s) => s.genresFor)
  const { saveSmart, deleteSmart } = useLibrary.getState()
  const playTracks = usePlayer((s) => s.playTracks)
  const go = useUi((s) => s.go)

  const [draft, setDraft] = useState(() => (existing ? { ...existing } : { ...EMPTY }))
  const [editing, setEditing] = useState(!existing)
  const current = existing && !editing ? existing : (draft as SmartPlaylist)

  const tracks = useMemo(
    () => evaluateSmart(current, buildUniverse(), { events, liked: likedSet, now: Date.now(), genresOf: genresFor }),
    // universe depends on catalog/liked/playlists/events; enrichment changes genres
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, events, likedSet, catalog, artistGenres, genresFor]
  )
  const mins = Math.round(tracks.reduce((n, t) => n + t.durationMs, 0) / 60_000)

  const setCond = (i: number, c: Partial<Condition>): void =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((x, j) => (j === i ? { ...x, ...c } : x)) }))

  return (
    <div className="page-pad">
      <div className="hero-head smart-hero">
        <div className="hero-art smart smart-hero-art">
          <Icon name="star" size={56} />
        </div>
        <div>
          <div className="eyebrow">Your collection / Smart playlist</div>
          <h1>{current.name}</h1>
          <div className="muted">
            {tracks.length} songs · {fmtMinutes(mins)} · updates automatically
          </div>
          <div className="actions">
            <button className="pill big" disabled={!tracks.length} onClick={() => playTracks(tracks)}>
              <Icon name="play" size={16} /> Play
            </button>
            {existing && !editing && (
              <button className="pill ghost" onClick={() => { setDraft({ ...existing }); setEditing(true) }}>
                Edit rules
              </button>
            )}
            {existing && (
              <button
                className="pill ghost"
                onClick={() => {
                  deleteSmart(id)
                  go({ name: 'home' })
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="panel form smart-rule-editor">
          <div className="smart-editor-heading"><div><p className="eyebrow">Make it yours</p><h2>Playlist rules</h2><p className="muted small">Choose what belongs here. Your collection updates as you listen.</p></div><span className="smart-rule-count">{draft.conditions.length} {draft.conditions.length === 1 ? 'rule' : 'rules'}</span></div>
          <label>
            Name
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} />
          </label>
          <div className="rule-head">
            Include songs that match
            <select value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value as 'all' | 'any' })}>
              <option value="all">all</option>
              <option value="any">any</option>
            </select>
            of these rules
          </div>
          {draft.conditions.map((c, i) => {
            const kind = FIELD_KIND[c.field]
            return (
              <div className="rule" key={i}>
                <select
                  value={c.field}
                  onChange={(e) => {
                    const f = e.target.value as Field
                    setCond(i, { field: f, op: OPS[FIELD_KIND[f]][0]!.op, value: defaultValue(f) })
                  }}
                >
                  {(Object.keys(FIELD_LABELS) as Field[]).map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABELS[f]}
                    </option>
                  ))}
                </select>
                <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Op })}>
                  {OPS[kind].map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {kind === 'bool' ? (
                  <select value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value === 'true' })}>
                    <option value="true">yes</option>
                    <option value="false">no</option>
                  </select>
                ) : (
                  <input
                    type={kind === 'number' ? 'number' : 'text'}
                    value={String(c.value)}
                    onChange={(e) => setCond(i, { value: kind === 'number' ? Number(e.target.value) : e.target.value })}
                  />
                )}
                <button type="button" className="icon-btn" aria-label="Remove rule" onClick={() => setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, j) => j !== i) }))}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            )
          })}
          <button type="button" className="link" onClick={() => setDraft((d) => ({ ...d, conditions: [...d.conditions, { field: 'artist', op: 'contains', value: '' }] }))}>
            + Add rule
          </button>
          <div className="rule">
            <span className="muted">Sort by</span>
            <select value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as SmartPlaylist['sort'] })}>
              <option value="plays">most played</option>
              <option value="recent">recently played</option>
              <option value="title">title</option>
              <option value="random">random</option>
            </select>
            <span className="muted">Limit</span>
            <input type="number" min={1} max={500} value={draft.limit} onChange={(e) => setDraft({ ...draft, limit: Math.max(1, Number(e.target.value) || 50) })} />
          </div>
          <div className="actions">
            <button
              className="pill big"
              onClick={() => {
                const newId = saveSmart({ ...draft, name: draft.name.trim() || 'Smart playlist', id: existing?.id })
                setEditing(false)
                if (!existing) go({ name: 'smart', id: newId })
              }}
            >
              Save
            </button>
            {existing && (
              <button className="pill ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {!tracks.length && <div className="muted pad">Nothing matches yet. Songs appear here as your library and history grow.</div>}
      <TrackList tracks={tracks} />
    </div>
  )
}
