export type EmbedPlaybackState = 'playing' | 'paused' | 'ended' | 'buffering'

/** Tracks whether a YouTube pause followed a background transition and needs a user gesture. */
export class EmbedBackgroundResume {
  private backgrounded = false
  private state: EmbedPlaybackState = 'buffering'

  visibilityChanged(hidden: boolean, wantsPlayback: boolean): boolean {
    if (hidden) {
      this.backgrounded = true
      return false
    }
    return this.backgrounded && this.state === 'paused' && wantsPlayback
  }

  stateChanged(state: EmbedPlaybackState, wantsPlayback: boolean): boolean {
    this.state = state
    if (state === 'playing') {
      this.backgrounded = false
      return false
    }
    return state === 'paused' && this.backgrounded && wantsPlayback
  }

  resume(): void {
    this.backgrounded = false
    this.state = 'playing'
  }

  reset(): void {
    this.backgrounded = false
    this.state = 'buffering'
  }
}
