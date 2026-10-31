import { describe, expect, it } from 'vitest'
import { SourceRegistry, dedupeKey } from './registry'
import type { SourceProvider } from './provider'
import type { Track } from './types'

const track = (source: string, id: string, title = 'Song', artist = 'Artist', durationMs = 180_000): Track => ({
  ref: { source, id },
  title,
  artists: [artist],
  durationMs
})

const provider = (id: string, over: Partial<SourceProvider> = {}): SourceProvider => ({
  id,
  name: id,
  capabilities: { search: true, browse: false, download: false, needsKey: false },
  health: async () => 'ok',
  search: async () => ({ tracks: [track(id, '1')] }),
  getTrack: async () => null,
  resolve: async (tid) => ({ kind: 'url', url: `x://${id}/${tid}` }),
  ...over
})

describe('dedupeKey', () => {
  it('matches the same song across sources despite tags/punctuation', () => {
    expect(dedupeKey(track('a', '1', 'Hello (Remastered)', 'Adele'))).toBe(dedupeKey(track('b', '9', 'hello', 'ADELE', 181_000)))
  })
  it('prefers isrc', () => {
    expect(dedupeKey({ ...track('a', '1'), isrc: 'us123' })).toBe('isrc:US123')
  })
})

describe('SourceRegistry', () => {
  it('merges and dedupes by priority', async () => {
    const r = new SourceRegistry()
    r.register(provider('local'), 1)
    r.register(provider('net'), 2)
    const out = await r.search('x')
    expect(out).toHaveLength(1)
    expect(out[0]?.ref.source).toBe('local')
  })

  it('survives a failing provider and trips the breaker after 3 failures', async () => {
    let t = 0
    const r = new SourceRegistry({}, () => t)
    let calls = 0
    r.register(
      provider('bad', {
        search: async () => {
          calls++
          throw new Error('boom')
        }
      }),
      1
    )
    r.register(provider('good', { search: async () => ({ tracks: [track('good', '2', 'Other')] }) }), 2)
    for (let i = 0; i < 5; i++) expect(await r.search('x')).toHaveLength(1)
    expect(calls).toBe(3)
    t = 61_000
    await r.search('x')
    expect(calls).toBe(4)
  })

  it('reports provider failures separately without hiding successful results or leaking error details', async () => {
    const r = new SourceRegistry()
    r.register(provider('jamendo', {
      name: 'Jamendo',
      search: async () => { throw new Error('Jamendo 503 client_id=private-secret') }
    }), 1)
    r.register(provider('audius', {
      name: 'Audius',
      search: async () => ({ tracks: [track('audius', '2', 'Available')] })
    }), 2)

    const outcome = await r.searchDetailed('x')
    expect(outcome.tracks.map((t) => t.title)).toEqual(['Available'])
    expect(outcome.failures).toEqual([{
      providerId: 'jamendo',
      providerName: 'Jamendo',
      message: 'Source temporarily unavailable (HTTP 503). Try again.',
      retryable: true
    }])
    expect(JSON.stringify(outcome)).not.toContain('private-secret')
  })

  it('allows an explicit retry to reset a tripped circuit breaker', async () => {
    let now = 0
    let calls = 0
    const r = new SourceRegistry({}, () => now)
    r.register(provider('flaky', {
      search: async () => {
        calls++
        if (calls <= 3) throw new Error('network unavailable')
        return { tracks: [track('flaky', '1')] }
      }
    }))
    for (let i = 0; i < 3; i++) await r.searchDetailed('x')
    expect(calls).toBe(3)
    const paused = await r.searchDetailed('x')
    expect(paused.failures[0]?.retryable).toBe(true)
    const retried = await r.searchDetailed('x', { retry: true })
    expect(calls).toBe(4)
    expect(retried.failures).toHaveLength(0)
    expect(retried.tracks).toHaveLength(1)
  })

  it('identifies playback failures without exposing provider error details', async () => {
    const r = new SourceRegistry()
    r.register(provider('audius', {
      name: 'Audius',
      resolve: async () => { throw new Error('request failed token=private-secret') }
    }))
    await expect(r.resolve(track('audius', '1'))).rejects.toThrow('Unable to play from Audius.')
  })
  it('falls back to an alternate source when resolve fails', async () => {
    const r = new SourceRegistry()
    r.register(
      provider('a', {
        resolve: async () => {
          throw new Error('dead')
        }
      }),
      1
    )
    r.register(provider('b'), 2)
    const res = await r.resolve(track('a', '1'), [track('b', '7')])
    expect(res.ref.source).toBe('b')
  })

  it('emits partial results as providers answer', async () => {
    const r = new SourceRegistry()
    r.register(provider('a'), 1)
    r.register(provider('b', { search: async () => ({ tracks: [track('b', '2', 'Different')] }) }), 2)
    const sizes: number[] = []
    await r.search('x', { onPartial: (t) => sizes.push(t.length) })
    expect(sizes.at(-1)).toBe(2)
  })
})
