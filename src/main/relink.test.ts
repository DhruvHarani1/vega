import { describe, expect, it } from 'vitest'
import { ownerFolder, relinkError } from './relink'

const f = (id: string, path: string) => ({ id, path })

describe('ownerFolder', () => {
  it('matches whole segments, not prefixes (win32)', () => {
    const folders = [f('1', 'C:\\Music')]
    expect(ownerFolder('C:\\Music\\a.mp3', folders, 'win32')?.id).toBe('1')
    expect(ownerFolder('C:\\Music2\\x.mp3', folders, 'win32')).toBeUndefined()
  })
  it('ignores case on Windows', () => {
    expect(ownerFolder('c:\\MUSIC\\a.mp3', [f('1', 'C:\\Music')], 'win32')?.id).toBe('1')
  })
  it('handles a root folder', () => {
    expect(ownerFolder('C:\\a.mp3', [f('1', 'C:\\')], 'win32')?.id).toBe('1')
    expect(ownerFolder('/a.mp3', [f('1', '/')], 'linux')?.id).toBe('1')
  })
  it('prefers the deepest of nested folders', () => {
    const folders = [f('1', 'C:\\Music'), f('2', 'C:\\Music\\Rock')]
    expect(ownerFolder('C:\\Music\\Rock\\a.mp3', folders, 'win32')?.id).toBe('2')
    expect(ownerFolder('C:\\Music\\Jazz\\a.mp3', folders, 'win32')?.id).toBe('1')
  })
  it('is case-sensitive on posix', () => {
    const folders = [f('1', '/home/me/Music')]
    expect(ownerFolder('/home/me/Music/a.mp3', folders, 'linux')?.id).toBe('1')
    expect(ownerFolder('/home/me/music/a.mp3', folders, 'linux')).toBeUndefined()
    expect(ownerFolder('/home/me/Music2/a.mp3', folders, 'linux')).toBeUndefined()
  })
})

describe('relinkError', () => {
  it('explains a duplicate path', () => {
    expect(relinkError(new Error('UNIQUE constraint failed: tracks.path')).message).toBe('That file is already in your library as another track.')
  })
  it('passes other errors through', () => {
    const e = new Error('boom')
    expect(relinkError(e)).toBe(e)
  })
})
