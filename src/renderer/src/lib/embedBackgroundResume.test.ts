import { describe, expect, it } from 'vitest'
import { EmbedBackgroundResume } from './embedBackgroundResume'

describe('EmbedBackgroundResume', () => {
  it('requests a tap after the embed pauses while the page is hidden', () => {
    const playback = new EmbedBackgroundResume()
    playback.visibilityChanged(true, true)
    expect(playback.stateChanged('paused', true)).toBe(true)
  })

  it('requests a tap when the paused state arrives before the page becomes visible', () => {
    const playback = new EmbedBackgroundResume()
    playback.visibilityChanged(true, true)
    playback.stateChanged('paused', true)
    expect(playback.visibilityChanged(false, true)).toBe(true)
  })

  it('does not prompt for a user-initiated pause', () => {
    const playback = new EmbedBackgroundResume()
    playback.visibilityChanged(true, false)
    expect(playback.stateChanged('paused', false)).toBe(false)
    expect(playback.visibilityChanged(false, false)).toBe(false)
  })

  it('clears the background interruption after playback resumes', () => {
    const playback = new EmbedBackgroundResume()
    playback.visibilityChanged(true, true)
    expect(playback.stateChanged('paused', true)).toBe(true)
    expect(playback.stateChanged('playing', true)).toBe(false)
    expect(playback.visibilityChanged(false, true)).toBe(false)
  })

  it('does not carry an interruption into the next track', () => {
    const playback = new EmbedBackgroundResume()
    playback.visibilityChanged(true, true)
    playback.reset()
    expect(playback.stateChanged('paused', true)).toBe(false)
  })
})
