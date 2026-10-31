# Vega

Standalone personal music app: search, library, playlists, listening analytics and recommendations.
Built to replace Spotify as the music source for [Lyra](https://github.com/DhruvHarani1/lyra); Lyra's player UI
and synced lyrics get merged in later. Vega is the brightest star in the constellation Lyra.

Live web version: https://vega-musicv1.vercel.app

Stack: Electron + React + TypeScript + Zustand (same as Lyra).

## Status: milestone 7 (roadmap M1-M7 complete; Android is M8)

Add a music folder under **Sources**: it is scanned (tags, duration, cover art) into SQLite on desktop or IndexedDB in the browser, searchable instantly, and played from disk. A built-in **demo provider** (fictional catalog) stays available. Online sources plug in behind the
`SourceProvider` interface later: local files, Audius, Jamendo, Internet Archive, yt-dlp. See
[docs/design.md](docs/design.md) for architecture, provider research and roadmap.

Online: Audius works out of the box (no key). Jamendo needs a free client ID, paste it under Sources.

Optional accounts (Supabase): sign in to sync likes, playlists and listening history across devices. Setup in [docs/supabase-setup.md](docs/supabase-setup.md); without credentials Vega stays fully local.

Recommendations: genres learned from MusicBrainz, optional Last.fm similar artists, session co-listening, radio from any song, rule-based smart playlists.

Lyra player: the lyrics button opens Lyra's own fullscreen player (backdrop and video backgrounds, synced word-by-word lyrics, karaoke, themes) driven by Vega's playback.

Also: live radio, a 10-band equalizer (desktop), opt-in YouTube sources via your own yt-dlp or Piped (desktop), command palette (Ctrl+K).

Works today: search, play/queue/shuffle/repeat, likes, playlists (create, rename, reorder, delete), listening
insights (top artists/genres/tracks, clock, streak), recommendations (Made for you, Discover), persisted locally (SQLite / IndexedDB) and synced when signed in.

## Run

```bash
npm install
npm run dev        # Electron app
npm run dev:web    # web version, in a browser at http://localhost:5174 (Chrome/Edge for local folders)
npm run build:web  # static site in dist-web/
npm run dist       # Windows installer in release/ (needs a normal network; electron-builder downloads tooling)
npm test
npm run typecheck
```

If Electron's binary did not download during install: `node node_modules/electron/install.js`.

Shortcuts: Space play/pause, Ctrl+Left/Right previous/next.

## Layout

How it all fits together (desktop, web + Vercel functions, Android shell, Lyra, providers, sync): [docs/architecture.md](docs/architecture.md). Contributing and per-target setup: [CONTRIBUTING.md](CONTRIBUTING.md).

```
src/shared/      Track/Provider/Library contracts, SourceRegistry (fan-out, dedupe, circuit breaker), recs, stats
src/providers/   mock, local, audius, jamendo, archive, metadata (MusicBrainz, Last.fm)
src/renderer/    React UI, stores, audio engine (store/player.ts)
src/main/        Electron shell: SQLite (db.ts), folder scanner, vega-media:// protocol, IPC
src/preload/     contextBridge API
lyra/            Lyra's player UI (vendored) + host/ bridge to Vega; built to /lyra by `npm run build:lyra`
```

## License

MIT
