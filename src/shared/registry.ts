import type { Health, SearchKind, Shelf, SourceProvider, StreamSource } from './provider'
import type { Track, TrackRef } from './types'

const FAIL_LIMIT = 3
const COOLDOWN_MS = 60_000

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Identity used to collapse the same song offered by several sources. */
export function dedupeKey(t: Track): string {
  if (t.isrc) return `isrc:${t.isrc.toUpperCase()}`
  if (t.mbid) return `mbid:${t.mbid}`
  const bucket = Math.round(t.durationMs / 4000)
  return `t:${norm(t.artists[0] ?? '')}|${norm(t.title)}|${bucket}`
}

interface Slot {
  provider: SourceProvider
  priority: number
  fails: number
  downUntil: number
}

export interface ProviderSearchFailure {
  providerId: string
  providerName: string
  message: string
  retryable: boolean
}

export interface SearchOutcome {
  tracks: Track[]
  failures: ProviderSearchFailure[]
}

export interface RegistryEvents {
  onProviderError?(id: string, err: unknown): void
}

function describeFailure(err: unknown): { message: string; retryable: boolean } {
  const raw = err instanceof Error ? err.message : ''
  const status = raw.match(/\b(?:Audius|Jamendo|Internet Archive)\s+(\d{3})\b/i)?.[1]
  const code = status ? Number(status) : 0
  if (code === 408 || code === 425 || code === 429 || code >= 500) {
    return { message: `Source temporarily unavailable (HTTP ${code}). Try again.`, retryable: true }
  }
  if (code >= 400) {
    return { message: `Source rejected the request (HTTP ${code}). Check its configuration.`, retryable: false }
  }
  if (/timeout/i.test(raw)) return { message: 'Source timed out. Retry the search.', retryable: true }
  return { message: 'Could not reach this source. Check your connection and retry.', retryable: true }
}

/** Fan-out search, dedupe, circuit breaking and resolve fallback across providers. */
export class SourceRegistry {
  private slots = new Map<string, Slot>()

  constructor(
    private readonly events: RegistryEvents = {},
    private readonly now: () => number = Date.now
  ) {}

  register(provider: SourceProvider, priority = 100): void {
    this.slots.set(provider.id, { provider, priority, fails: 0, downUntil: 0 })
  }

  unregister(id: string): void {
    this.slots.delete(id)
  }

  list(): SourceProvider[] {
    return [...this.slots.values()].sort((a, b) => a.priority - b.priority).map((s) => s.provider)
  }

  get(id: string): SourceProvider | undefined {
    return this.slots.get(id)?.provider
  }

  private available(): Slot[] {
    const t = this.now()
    return [...this.slots.values()].filter((s) => s.downUntil <= t).sort((a, b) => a.priority - b.priority)
  }

  private ok(s: Slot): void {
    s.fails = 0
    s.downUntil = 0
  }

  private fail(s: Slot, err: unknown): void {
    s.fails += 1
    if (s.fails >= FAIL_LIMIT) s.downUntil = this.now() + COOLDOWN_MS
    this.events.onProviderError?.(s.provider.id, err)
  }

  async health(): Promise<Record<string, Health>> {
    const out: Record<string, Health> = {}
    await Promise.all(
      [...this.slots.values()].map(async (s) => {
        try {
          out[s.provider.id] = await s.provider.health()
        } catch {
          out[s.provider.id] = 'down'
        }
      })
    )
    return out
  }

  /**
   * Search every enabled provider independently. Failures are returned separately from empty results,
   * while successful providers continue contributing tracks. A retry resets circuit breakers.
   */
  async searchDetailed(
    q: string,
    opts: {
      kind?: SearchKind
      limit?: number
      timeoutMs?: number
      signal?: AbortSignal
      onPartial?: (tracks: Track[]) => void
      retry?: boolean
    } = {}
  ): Promise<SearchOutcome> {
    const { kind = 'track', limit = 25, timeoutMs = 4000, signal, onPartial, retry = false } = opts
    const slots = [...this.slots.values()]
      .filter((s) => s.provider.capabilities.search)
      .sort((a, b) => a.priority - b.priority)
    if (retry) for (const s of slots) this.ok(s)

    const results: Track[][] = slots.map(() => [])
    const failures: ProviderSearchFailure[] = []
    const arrived = new Map<string, Track>()

    await Promise.all(
      slots.map(async (s, i) => {
        if (signal?.aborted) return
        if (s.downUntil > this.now()) {
          failures.push({
            providerId: s.provider.id,
            providerName: s.provider.name,
            message: 'Source temporarily paused after repeated failures. Retry to try again.',
            retryable: true
          })
          return
        }
        try {
          const r = await withTimeout(s.provider.search(q, { kind, limit, signal }), timeoutMs)
          if (signal?.aborted) return
          this.ok(s)
          results[i] = r.tracks
          if (onPartial) {
            for (const t of r.tracks) if (!arrived.has(dedupeKey(t))) arrived.set(dedupeKey(t), t)
            onPartial([...arrived.values()])
          }
        } catch (err) {
          if (signal?.aborted) return
          this.fail(s, err)
          failures.push({ providerId: s.provider.id, providerName: s.provider.name, ...describeFailure(err) })
        }
      })
    )

    const merged = new Map<string, Track>()
    for (const list of results) for (const t of list) if (!merged.has(dedupeKey(t))) merged.set(dedupeKey(t), t)
    return { tracks: [...merged.values()], failures }
  }

  /** Backwards-compatible search API for callers that only need tracks. */
  async search(
    q: string,
    opts: {
      kind?: SearchKind
      limit?: number
      timeoutMs?: number
      signal?: AbortSignal
      onPartial?: (tracks: Track[]) => void
    } = {}
  ): Promise<Track[]> {
    return (await this.searchDetailed(q, opts)).tracks
  }

  async browse(): Promise<Shelf[]> {
    const shelves: Shelf[] = []
    for (const s of this.available()) {
      if (!s.provider.browse) continue
      try {
        shelves.push(...(await withTimeout(s.provider.browse(), 4000)))
        this.ok(s)
      } catch (err) {
        this.fail(s, err)
      }
    }
    return shelves
  }

  /** Ask the track's source to prepare it in the background (next in queue, top search results). */
  warm(track: Track): void {
    const slot = this.slots.get(track.ref.source)
    if (slot && slot.downUntil <= this.now()) slot.provider.warm?.(track.ref.id)
  }

  /** Resolve a track; if its own source fails, try other sources offering the same song (alternates). */
  async resolve(track: Track, alternates: Track[] = []): Promise<{ stream: StreamSource; ref: TrackRef }> {
    const same = alternates.filter((a) => dedupeKey(a) === dedupeKey(track) && a.ref.source !== track.ref.source)
    const failed: string[] = []
    for (const c of [track, ...same]) {
      const slot = this.slots.get(c.ref.source)
      if (!slot || slot.downUntil > this.now()) continue
      try {
        const stream = await slot.provider.resolve(c.ref.id)
        this.ok(slot)
        return { stream, ref: c.ref }
      } catch (err) {
        failed.push(slot.provider.name)
        this.fail(slot, err)
      }
    }
    if (failed.length) throw new Error(`Unable to play from ${failed.join(', ')}. Try again or choose another result.`)
    throw new Error('No available source could play this track. Try again or choose another result.')
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}
