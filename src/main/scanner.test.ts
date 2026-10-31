import { mkdtemp, mkdir, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryDb } from './db'
import { scanFolder } from './scanner'
import type { ScanProgress } from '@shared/library'

/** Minimal mono 8 kHz 16-bit WAV with RIFF INFO tags (title/artist/album/genre). */
function wav(seconds: number, tags: { INAM?: string; IART?: string; IPRD?: string; IGNR?: string }): Buffer {
  const rate = 8000
  const data = Buffer.alloc(rate * seconds * 2)
  const info = Object.entries(tags).map(([id, v]) => {
    const txt = Buffer.from(`${v}\0`)
    const pad = txt.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
    const h = Buffer.alloc(8)
    h.write(id, 0)
    h.writeUInt32LE(txt.length, 4)
    return Buffer.concat([h, txt, pad])
  })
  const infoBody = Buffer.concat([Buffer.from('INFO'), ...info])
  const listHdr = Buffer.alloc(8)
  listHdr.write('LIST', 0)
  listHdr.writeUInt32LE(infoBody.length, 4)
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0)
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(1, 10)
  fmt.writeUInt32LE(rate, 12)
  fmt.writeUInt32LE(rate * 2, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)
  const dataHdr = Buffer.alloc(8)
  dataHdr.write('data', 0)
  dataHdr.writeUInt32LE(data.length, 4)
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, listHdr, infoBody, dataHdr, data])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0)
  riff.writeUInt32LE(body.length, 4)
  return Buffer.concat([riff, body])
}

let dir: string
let db: LibraryDb
const events: ScanProgress[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vega-scan-'))
  db = new LibraryDb(':memory:')
  events.length = 0
  await mkdir(join(dir, 'Album One'))
  await writeFile(join(dir, 'Album One', '01 Midnight Drive.wav'), wav(2, { INAM: 'Midnight Drive', IART: 'Nova Lumen', IPRD: 'Neon Harbor', IGNR: 'Synthwave' }))
  await writeFile(join(dir, 'Album One', '02 Cafe Rain.wav'), wav(1, { INAM: 'Cafe Rain', IART: 'Mika Ono', IPRD: 'Window Seat' }))
  await writeFile(join(dir, 'untagged song.wav'), wav(1, {}))
  await writeFile(join(dir, 'Beyoncé Halo.wav'), wav(1, {}))
  await writeFile(join(dir, 'notes.txt'), 'ignore me')
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const scan = async (): Promise<void> => {
  const { id } = db.addFolder(dir)
  await scanFolder(db, id, dir, join(dir, '.art'), (p) => events.push(p))
}

describe('scanFolder', () => {
  it('indexes audio files with tags and falls back to filename', async () => {
    await scan()
    expect(events.at(-1)?.phase).toBe('done')
    const all = db.all(100)
    expect(all).toHaveLength(4)
    const mid = all.find((t) => t.title === 'Midnight Drive')
    expect(mid?.artist).toBe('Nova Lumen')
    expect(mid?.album).toBe('Neon Harbor')
    expect(mid?.genre).toBe('Synthwave')
    expect(mid?.duration_ms).toBeGreaterThan(1500)
    expect(all.find((t) => t.title === 'untagged song')?.artist).toBe('Unknown Artist')
  })

  it('searches with prefix matching and ignores diacritics', async () => {
    await scan()
    expect(db.search('mid dri', 10).map((t) => t.title)).toEqual(['Midnight Drive'])
    expect(db.search('cafe', 10).map((t) => t.title)).toEqual(['Cafe Rain'])
    expect(db.search('beyonce', 10).map((t) => t.title)).toEqual(['Beyoncé Halo'])
    expect(db.search('mika', 10)).toHaveLength(1)
    expect(db.search('"; DROP', 10)).toHaveLength(0)
  })

  it('retains deleted files as unavailable library entries', async () => {
    await scan()
    events.length = 0
    await scan()
    expect(events.at(-1)).toMatchObject({ phase: 'done', total: 0, added: 0 })

    await unlink(join(dir, 'untagged song.wav'))
    await writeFile(join(dir, 'new one.wav'), wav(1, { INAM: 'Brand New', IART: 'X' }))
    events.length = 0
    await scan()
    expect(events.at(-1)).toMatchObject({ phase: 'done', total: 1, added: 1, removed: 1 })
    const all = db.all(100)
    expect(all.map((t) => t.title).sort()).toEqual(['Beyoncé Halo', 'Brand New', 'Cafe Rain', 'Midnight Drive', 'untagged song'])
    expect(all.find((t) => t.title === 'untagged song')?.available).toBe(0)
    expect(all.find((t) => t.title === 'Brand New')?.available).toBe(1)
  })

  it('relinks a moved file without changing its library identity', async () => {
    await scan()
    const original = db.all(100).find((t) => t.title === 'Midnight Drive')!
    await unlink(join(dir, 'Album One', '01 Midnight Drive.wav'))
    const recoveredDir = join(dir, 'Recovered')
    await mkdir(recoveredDir)
    const recoveredPath = join(recoveredDir, 'Midnight Drive.wav')
    await writeFile(recoveredPath, wav(2, { INAM: 'Midnight Drive', IART: 'Nova Lumen', IPRD: 'Neon Harbor', IGNR: 'Synthwave' }))
    const folder = db.addFolder(dir)
    db.relinkTrack(original.id, recoveredPath, folder.id)
    await scanFolder(db, folder.id, dir, join(dir, '.art'), (p) => events.push(p))
    const restored = db.getTrack(original.id)
    expect(restored?.path).toBe(recoveredPath)
    expect(restored?.available).toBe(1)
    expect(db.all(100).filter((t) => t.title === 'Midnight Drive')).toHaveLength(1)
  })

  it('removing a folder cascades to tracks and search index', async () => {
    await scan()
    const [f] = db.folders()
    db.removeFolder(Number(f!.id))
    expect(db.all(100)).toHaveLength(0)
    expect(db.search('midnight', 10)).toHaveLength(0)
  })

  it('kv store round-trips', () => {
    db.kvSet('liked', '[1]')
    db.kvSet('liked', '[2]')
    expect(db.kvGetAll()).toEqual({ liked: '[2]' })
  })
})
