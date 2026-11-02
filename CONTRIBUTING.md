# Contributing to Vega

Thanks for helping. Pick an issue (start with `good first issue` / `help wanted`), comment that you are taking it, and open a pull request.

Read [docs/architecture.md](docs/architecture.md) first: it explains how the desktop app, the web build, the Android shell, the Lyra player and the providers fit together, and where to make a change.

## Setup

Requirements: Node 24 (CI uses it) and npm. Run `npm ci` once at the repo root. The `dev`, `dev:web`, `dev:agent` and `build*` scripts build the vendored Lyra player first.

```bash
npm ci
npm run typecheck   # main/preload, renderer/shared/providers, and lyra
npm test            # Vitest for Vega, then for Lyra
```

Run `npm run typecheck` and the whole `npm test` before opening a PR; CI runs both plus `npm run build:web`.

### Web (easiest way to start)

```bash
npm run dev:web     # http://localhost:5174, with the /api functions served locally (no `vercel dev` needed)
npm run build:web   # static site in dist-web/
node scripts/serve-dist.mjs   # after build:web: serve dist-web with the headers and CSP from vercel.json
```

Use Chrome or Edge to try adding a local music folder (File System Access API). Search and shelves call `api/` and, through it, public YouTube Music endpoints. If you add a host the browser must call, add it to the Content-Security-Policy in `vercel.json`.

### Desktop (Electron)

```bash
npm run dev         # Electron app with hot reload
VEGA_USERDATA=/tmp/vega-test npm run dev   # use a throwaway profile so you do not touch your own library
```

If Electron's binary did not download during install: `node node_modules/electron/install.js`. Changes in `src/main/` or `src/preload/` need an app restart; if you add an IPC call, update `src/shared/ipc.ts`, `src/preload/index.ts` and `src/main/library.ts` together. `npm run dist` builds the Windows installer (needs a normal network).

### Android

The Android app is a WebView shell around the hosted web app, so most UI work needs no Android tooling: use the web setup above. For native changes you need JDK 17 and the Android SDK; see [docs/android.md](docs/android.md).

```bash
npm run android:debug     # debug APK
npm run android:dev       # debug APK that loads http://10.0.2.2:5174 (serve the web app on port 5174 first, see docs/android.md), then installs it
```

Never commit a keystore or `android/local.properties`.

### Test runs without touching real accounts

```bash
npm run dev:agent   # same as dev:web, but cloud features are off: no Supabase, no sign-in
```

`dev:agent` sets `VITE_CLOUD=off`, so the browser never contacts Vega's Supabase project. Use it for any run done by an AI agent, for screenshots, and whenever you do not need accounts. **AI agents (Claude Code or others) must use `npm run dev:agent`**, never sign in to the real project, never read or write user data, and never run `npm run db:migrate`; migrations are written in `supabase/migrations/`, reviewed, and run by the owner. To work on sync or sign-in, create your own Supabase project (see [docs/supabase-setup.md](docs/supabase-setup.md)) and point `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at it in an untracked `.env.local`.

## Pull requests

- One issue per PR; link it (`Closes #N`).
- Branch from `staging` and target `staging`; `main` only receives reviewed release batches from the owner. The owner merges.
- `npm run typecheck` and `npm test` must pass. Add tests for logic you add or change.
- UI changes: include screenshots at desktop and phone (375 px) width.
- Match the surrounding code style. No new dependencies without a reason in the PR description.
- Do not commit secrets, `.env` files or API keys.
- AI agents working in this repo also follow [AGENTS.md](AGENTS.md), [.agents/PROTOCOL.md](.agents/PROTOCOL.md) and [docs/agents/README.md](docs/agents/README.md): claim the issue before building, add `Agent-Org` / `Agent` trailers to commits, and never merge, tag or publish.

## What we will not accept

- Anything that circumvents YouTube bot checks or spoofs clients to extract streams.
- Storing or redistributing copyrighted audio from our own servers.
- Tracking that identifies users.

## Releases

Maintainers tag releases (`vX.Y.Z`); CI builds the Windows installer and the Android APK.
