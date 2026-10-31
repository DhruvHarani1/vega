import type { VegaDesktopApi } from '@shared/ipc'
import type { LibraryBackend } from '@shared/library'

const toBase64Url = (s: string): string => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** vega-media://stream/<b64url> for an https URL: plays through the main process (adds CORS headers, optional disk cache). */
export const toStreamUrl = (url: string): string => `vega-media://stream/${toBase64Url(url)}`

/** Desktop backend: thin adapter over the preload IPC bridge (SQLite lives in the main process). */
export function createDesktopBackend(api: VegaDesktopApi): LibraryBackend {
  return {
    kind: 'desktop',
    supported: true,
    folders: () => api.library.folders(),
    addFolder: () => api.library.addFolder(),
    removeFolder: (id) => api.library.removeFolder(id),
    rescan: (id) => api.library.rescan(id),
    onScanProgress: (cb) => api.library.onScanProgress(cb),
    search: (q, limit) => api.library.search(q, limit),
    all: (limit) => api.library.all(limit),
    getTrack: (id) => api.library.getTrack(id),
    relinkTrack: (id) => api.library.relinkTrack(id),
    streamUrl: async (id) => `vega-media://file/${encodeURIComponent(id)}`,
    proxyStream: (url) => (/^https:\/\//.test(url) ? toStreamUrl(url) : url),
    kvGetAll: () => api.kv.getAll(),
    kvSet: (key, value) => api.kv.set(key, value)
  }
}
