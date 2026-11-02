# Vega architecture

How the pieces fit together today. For the original design reasoning and roadmap see [design.md](design.md); for the Android shell in depth see [android.md](android.md); for Supabase setup see [supabase-setup.md](supabase-setup.md).

Vega is one React app shipped three ways:

| Target | What runs | Entry |
|---|---|---|
| Desktop | Electron: main process + sandboxed renderer | `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/` |
| Web | The same renderer as a static site, plus serverless functions | `vite.web.config.ts` -> `dist-web/`, `api/` |
| Android | A Kotlin WebView shell that loads the hosted web app | `android/` |

Lyra's player UI (`lyra/`) is built separately and shown inside the renderer on all three.

```
                         src/renderer  (React + Zustand, shared by all targets)
                        /                    |                       \
   window.vega present?                      |                        \
        yes                                  no                        no + window.vegaAndroid
   Electron main (SQLite,                 Browser: IndexedDB,          Android WebView shell
   yt-dlp, stream proxy)                  File System Access,          (media session, foreground
                                          YouTube IFrame embed,        service) around the hosted
                                          /api/* Vercel functions      web app
```

## Repository layout

```
src/shared/      Contracts and pure logic used by every layer: Track, SourceProvider, SourceRegistry,
                 LibraryBackend, IPC channel names, sync merge, recommendations, smart playlists, stats
src/providers/   One folder per source: local, mock, audius, jamendo, archive, radio, ytm, plus metadata (MusicBrainz, Last.fm)
src/main/        Electron main process
src/preload/     contextBridge API exposed as window.vega
src/renderer/    React UI: views/, components/, store/ (Zustand), lib/ (backends, sync, bridges), styles/
api/             Vercel serverless functions (web only)
lyra/            Vendored Lyra player UI, built to src/renderer/public/lyra
android/         Android WebView shell (Kotlin)
supabase/        SQL migrations for optional accounts
```

Path aliases (`electron.vite.config.ts`, `vite.web.config.ts`): `@shared` -> `src/shared`, `@providers` -> `src/providers`, `@` -> `src/renderer/src`. Lyra has its own aliases in `vite.lyra.config.ts`.

## Desktop (Electron)

**Main process** (`src/main/`):

- `index.ts` creates the window (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and loads the built UI from the `vega-app://app/` protocol, or the dev server URL when running unpackaged. External links open in the system browser.
- `library.ts` owns the IPC handlers and the two custom protocols (both declared in `src/shared/ipc.ts`):
  - `vega-app://` serves the built renderer from a real origin (instead of `file://`) so the app page and the Lyra iframe can talk. Path traversal is blocked.
  - `vega-media://` serves audio to the renderer with Range support and CORS headers (the equalizer reads the stream through Web Audio). `vega-media://file/<trackId>` is a local file, `vega-media://art/<file>` is cached cover art, `vega-media://stream/<base64url(https url)>` is an online stream.
- `db.ts` is the SQLite library (folders, tracks, key-value app state) in the user data directory; `scanner.ts` walks music folders and reads tags, duration and cover art.
- `streamProxy.ts` fetches remote audio with Node's `https`, passes Range headers through, follows redirects (every hop must be an allowed public https host) and streams chunk by chunk. `streamCache.ts` is the on-disk cache in front of it (size cap configurable, default in `DEFAULT_MAX_MB`).
- `ytdlp.ts` runs yt-dlp as a child process (arguments as an array, never through a shell) to search and resolve stream URLs; resolved URLs are cached and `warm()` resolves ahead of time. `ytmusic.ts` is the fast YouTube Music catalogue search used before falling back to yt-dlp search. `updater.ts` wraps electron-updater.

**Preload** (`src/preload/index.ts`) is the only bridge: it builds a `VegaDesktopApi` (typed in `src/shared/ipc.ts`) from `ipcRenderer.invoke` calls and exposes it as `window.vega`. When you add an IPC call, add the channel to `CH` in `ipc.ts`, the type to `VegaDesktopApi`, the wrapper in preload, and the handler in `library.ts`.

**Renderer** is the shared React app. It picks its backend once, in `lib/backend.ts`: `window.vega ? createDesktopBackend(window.vega) : createWebBackend()`. Both implement `LibraryBackend` (`src/shared/library.ts`), so the rest of the UI does not know which one it has.

## Web build and Vercel functions

- `npm run build:web` (`vite.web.config.ts`) builds the renderer to `dist-web/`. `vercel.json` runs it, serves `dist-web`, and sets the security headers including the CSP (`connect-src`, `frame-src` for YouTube). Any new external host the browser must call needs adding to that CSP.
- `lib/webBackend.ts` is the browser `LibraryBackend`: IndexedDB for metadata and app state, the File System Access API for the user's own audio files (Chromium browsers). Files are not uploaded or copied.
- `api/` holds the serverless functions. They exist because the browser cannot call these hosts directly (CORS, rate limits):
  - `api/ytm/search.ts` and `api/ytm/shelves.ts`: YouTube Music catalogue search and home shelves, using `src/main/ytmusic.ts` (shared with desktop). Search falls back to the YouTube Data API (`api/ytm/_dataApi.ts`) when the `YT_API_KEY` env var is set on the server. Responses carry CDN cache headers.
  - `api/lrclib.ts`: cached pass-through to LRCLIB for lyrics, restricted to `/get` and `/search`.
  - `api/img.ts`: same-origin proxy for YouTube artwork hosts only, so the player can read the image to derive a colour theme.
  - `api/_limit.ts`: best-effort per-instance rate limit shared by the handlers.
- `npm run dev:web` serves the same functions locally through a small Vite plugin (`devApi()` in `vite.web.config.ts`), so you do not need `vercel dev`. `main` deploys to production on Vercel; `staging` gets previews.

## Android shell

`android/` is a plain Kotlin WebView (no Capacitor) that loads the hosted web app (`BuildConfig.VEGA_URL`, default the Vercel deployment; debug builds can point at a dev server). That keeps `/api/*` and the CSP identical to the browser and means UI changes ship with a Vercel deploy, not an APK. Native code only adds what a WebView lacks:

- `VegaWeb.kt` the retained WebView and the bridge, `MainActivity.kt` window and back handling, `PlaybackService.kt` foreground service with MediaSession, notification and wake/Wi-Fi locks (so audio continues with the screen off), `AppUpdater.kt` APK self-update from GitHub releases.
- The bridge is `src/renderer/src/lib/androidBridge.ts`: the page posts now-playing state to `window.vegaAndroid`, and native sends transport commands and the hardware back event to `window.__vegaAndroid`. It is a no-op outside the WebView.

Details, signing and build commands are in [android.md](android.md).

## Providers and the registry

Everything that can supply music implements `SourceProvider` (`src/shared/provider.ts`):

- `search`, `getTrack`, `health`, optional `browse` (home shelves) and `warm`.
- `resolve(id)` returns a `StreamSource` just in time: `{kind: 'url', url, headers?, expiresAt?}`, `{kind: 'file', path}`, or `{kind: 'embed', provider: 'youtube', videoId}`. Resolved streams are never persisted; only `TrackRef`s (`{source, id}`) are stored in likes, playlists and history. That is why a synced library plays on any device.

`SourceRegistry` (`src/shared/registry.ts`) combines providers:

- **Search** fans out to every enabled provider in parallel with a per-provider timeout, returns partial results as they arrive, de-duplicates the same song across sources (`dedupeKey`: ISRC, then MusicBrainz id, then normalised artist + title + duration bucket), and reports per-provider failures separately from empty results.
- **Priority:** a lower number wins dedupe ties. Registered in `src/renderer/src/lib/sources.ts`: local files 10, YouTube Music 30, Audius 50, Internet Archive 55, Jamendo 60, radio 70, demo catalogue 100.
- **Circuit breaker:** 3 consecutive failures pause a provider for 60 s; a retry resets it.
- **Resolve fallback:** if a track's own source fails, `resolve()` tries other sources offering the same song from the queue.

`lib/sources.ts` creates the single app-wide registry and `applyOnlineSources()` registers or unregisters providers from the user's settings. The YouTube Music provider has two implementations behind the same id `ytm`: `providers/ytm/index.ts` (desktop, uses `window.vega`) and `providers/ytm/web.ts` (web and Android, calls `/api/ytm`). To add a source: implement `SourceProvider` in `src/providers/<name>/`, register it in `sources.ts` with a priority, add a toggle in settings, and add its host to the CSP in `vercel.json` if the browser calls it directly.

## How a track plays

All playback is driven by `src/renderer/src/store/player.ts`: one `HTMLAudioElement` plus, on web, YouTube's embedded player. `startCurrent()` does:

1. If the user saved the track for offline use on web (`lib/offline.ts`, IndexedDB, only for Audius, Jamendo and Internet Archive), play that blob.
2. Otherwise `sources.resolve(track, queue)` returns a `StreamSource`.
3. `kind: 'embed'` -> load the video in the YouTube player (`lib/ytEmbed.ts`); `kind: 'url'` -> `audio.src = backend.proxyStream?.(url) ?? url`.
4. Warm the next queue item (`sources.warm`) so skipping is fast, update the Media Session, and log the listen for analytics when the track ends or is skipped.

Per platform:

| | Local file | YouTube Music | Other online (Audius, Jamendo, Archive, radio) |
|---|---|---|---|
| **Desktop** | `vega-media://file/<id>` from disk | `ytdlp.resolve(id)` returns a direct audio URL (user's bundled/installed yt-dlp), wrapped as `vega-media://stream/...` so the main process proxies and disk-caches it | URL wrapped as `vega-media://stream/...` |
| **Web** | File System Access handle read in the browser | `/api/ytm` finds the track, then `resolve` returns an `embed` source; YouTube's IFrame player plays it, hidden, with Vega's own controls | URL played directly by `<audio>` (sources must allow CORS) |
| **Android** | n/a for the shell itself: it runs the web build, so this is the Web column inside the WebView | same as web (IFrame embed); the foreground service and silent keep-alive audio (`lib/keepAlive.ts`) keep it alive with the screen off | same as web |

Embedded YouTube playback means the audio is YouTube's own player; Vega does not extract or store web streams. Desktop yt-dlp resolution runs on the user's machine with their own copy of yt-dlp. Do not add anything that circumvents bot checks or spoofs clients (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

When the web page is hidden, the browser can pause the embed; `lib/embedBackgroundResume.ts` detects that and shows a tap-to-resume prompt instead of failing silently.

## Lyra player

`lyra/` is Lyra's own player UI (React, lyrics engine, themes) vendored into this repo with its own `tsconfig` and tests. `npm run build:lyra` (`vite.lyra.config.ts`) builds it to `src/renderer/public/lyra`, so every Vega build serves it as static files at `lyra/index.html`. Run `build:lyra` before dev or build (the `dev`, `dev:web`, `dev:agent` and `build*` scripts already do).

Vega shows it in a same-origin iframe (`views/LyraPlayer.tsx`, and a mini mode in `components/QueuePanel.tsx`). Vega stays the source of truth: `src/renderer/src/lib/lyraHost.ts` exposes `window.__vegaHost` with a playback snapshot (track, position, play state, volume) and accepts commands (play, pause, next, seek ...); `lyra/host/` is the Lyra-side adapter (`api.ts`, `platform.ts`, `media.ts`). Lyra never plays audio itself here. Lyrics come from LRCLIB (through `/api/lrclib` on web).

## Accounts and sync

Accounts are optional. Without credentials, or when `VITE_CLOUD=off`, `supabase` in `lib/supabase.ts` is `null` and Vega is fully local.

- **Client:** `lib/supabase.ts` creates the Supabase client with the public anon key (PKCE flow, session persisted). Every table is protected by Row Level Security so a user reaches only their own rows. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` point a build at another project. `npm run dev:agent` sets `VITE_CLOUD=off` so test runs can never reach the real project.
- **Schema:** `supabase/migrations/*.sql` (liked tracks, playlists, user settings, play events). Migrations are run by the project owner (`npm run db:migrate`); do not run them against the live project from a contributor or agent session.
- **Trigger:** `store/auth.ts` runs `syncOnce()` after sign-in, then debounced (4 s) on any library change, when the browser comes back online, and on window focus if the last sync is over a minute old. A different account signing in on the same device wipes the previous account's synced data first.
- **Merge:** `lib/sync.ts` does one full pass: pull remote, reconcile, apply remote changes locally, push local changes. Likes, playlists and smart playlists (stored in `user_settings` under `smart:<id>`) are **last-write-wins by `updatedAt`**, deletes are tombstones (`deleted: true`). Play events are append-only: a union by deterministic id (`startedAt-source:id`), pulled with a `synced_at` cursor. The pure merge logic is in `src/shared/sync.ts` (`reconcile`, `mergeEvents`) and unit-tested in `sync.test.ts`.
- **Local state:** likes, playlists and history live in the key-value store behind `lib/persist.ts` (SQLite on desktop, IndexedDB on web), read synchronously from an in-memory cache filled at startup.

## Checks

`npm run typecheck` runs `tsc` for main/preload, for the renderer/shared/providers, and for `lyra/`. `npm test` runs Vitest for Vega and then for Lyra (`vitest.config.ts`, `vitest.lyra.config.ts`). CI (`.github/workflows/ci.yml`) runs typecheck, tests and `build:web`.
