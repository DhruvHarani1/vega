import { SourceRegistry } from '@shared/registry'
import { createMockProvider } from '@providers/mock'
import { createLocalProvider } from '@providers/local'
import { createAudiusProvider } from '@providers/audius'
import { createJamendoProvider } from '@providers/jamendo'
import { createArchiveProvider } from '@providers/archive'
import { createRadioProvider } from '@providers/radio'
import { createYtmProvider } from '@providers/ytm'
import { createYtmWebProvider } from '@providers/ytm/web'
import { backend } from './backend'

/**
 * The app-wide source registry. Lower priority number wins dedupe ties, so the user's own files beat everything.
 * Online providers (M3) register here too.
 */
export const sources = new SourceRegistry({
  onProviderError: (id) => console.warn(`[source:${id}] request failed`)
})

sources.register(createLocalProvider(backend), 10)

const mock = createMockProvider()

/** Radio is queried directly by the Radio view (its stations are not songs), but registered for browse shelves and resolve. */
export const radio = createRadioProvider()

/** The demo catalog is a stand-in for a real library; it can be switched off once real music is added. */
export function setDemoEnabled(on: boolean): void {
  if (on) sources.register(mock, 100)
  else sources.unregister(mock.id)
}

/** Registers/unregisters online providers to match settings. Jamendo only exists once the user supplies a client id. */
export function applyOnlineSources(cfg: { audius: boolean; archive: boolean; radio: boolean; ytm: boolean; jamendoClientId: string }): void {
  // YouTube Music: the main catalogue, on by default (desktop: yt-dlp streams; web: /api search + embedded player)
  if (cfg.ytm) sources.register(window.vega ? createYtmProvider(window.vega) : createYtmWebProvider(), 30)
  else sources.unregister('ytm')
  if (cfg.radio) sources.register(radio, 70)
  else sources.unregister('radio')
  if (cfg.archive) sources.register(createArchiveProvider(), 55)
  else sources.unregister('archive')
  if (cfg.audius) sources.register(createAudiusProvider(), 50)
  else sources.unregister('audius')
  if (cfg.jamendoClientId) sources.register(createJamendoProvider({ clientId: cfg.jamendoClientId }), 60)
  else sources.unregister('jamendo')
}

const hoverTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Pointer is resting on a track: after a moment, get it ready so a click starts playing immediately. */
export function warmOnHover(track: import('@shared/types').Track): { onMouseEnter: () => void; onMouseLeave: () => void } {
  const key = `${track.ref.source}:${track.ref.id}`
  return {
    onMouseEnter: () => {
      clearTimeout(hoverTimers.get(key))
      hoverTimers.set(key, setTimeout(() => sources.warm(track), 140))
    },
    onMouseLeave: () => clearTimeout(hoverTimers.get(key))
  }
}
