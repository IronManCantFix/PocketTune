# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SPlayer is a web music player built with **Vue 3 + TypeScript**, deployable via Docker or run in local development. It uses Naive UI for components, Pinia for state management, and integrates with NetEase Cloud Music API (via a self-hosted Fastify server), UnblockNeteaseMusic (song unblocking), Last.fm, and Subsonic/Navidrome streaming services. The Electron desktop variant has been removed.

## Commands

```bash
pnpm api             # Start self-hosted API server (tsx server/index.ts, port 3000 by default)
pnpm dev             # Start Vite dev server (proxy /api -> 127.0.0.1:3000)
pnpm build           # Full production build (typecheck + vite build)
pnpm lint            # ESLint (--max-warnings=0, zero tolerance)
pnpm format          # Prettier
pnpm typecheck:web   # Renderer TypeScript check (vue-tsc)
pnpm typecheck:server # Server TypeScript check (tsc)
```

Set `VITE_DEV_API_PORT` to change the dev proxy target port; `VITE_API_URL` overrides the API base path.

## Architecture

### Server (`server/`)

Self-contained Fastify app shared by local dev (`pnpm api`) and Docker (`npx tsx server/index.ts`):

- `server/netease/` — NetEase Cloud Music API (wraps `@neteasecloudmusicapienhanced/api`), mounted at `/api/netease/*`
- `server/unblock/` + `server/unm/` — UnblockNeteaseMusic as a library (`@unblockneteasemusic/server`), mounted at `/api/unblock/*`, also post-processes `song_url*`/`song_download_url*` responses (replaces unavailable URLs)
- `server/qqmusic/` — QQ Music lyric matching (QRC), mounted at `/api/qqmusic/*`
- Env: `PORT`, `LOG_LEVEL`, `UNM_ENABLED`, `UNBLOCK_SOURCES`, `MIN_BR`, `AMLL_DB_SERVER`

### Renderer (`src/`)

- **Stores** (`stores/`): Pinia with persistedstate — `data` (songs/user), `status` (playback), `setting` (config), `music`, `streaming`
- **Core** (`core/`): `audio-player/` (web playback engine + ffmpeg worker), `automix/`, `player/` (state), `resource/` (caching/downloads)
- **API** (`api/`): Axios-based, organized by domain (song, playlist, login, streaming, lastfm)
- **Composables** (`composables/`): `useInit`, `useSongMenu`, `useQualityControl`, etc.
- **Components** (`components/`): AMLL (lyrics), Card, Common, Global, Layout, List, Menu, Modal, Player, Search, Setting, UI

### Native (WASM only)

`native/ferrous-opencc-wasm` — Chinese character conversion (prebuilt WASM pkg, consumed via `@opencc` alias). All Rust desktop modules were removed.

### Deployment

- **Docker**: nginx serves `dist/` and reverse-proxies `/api/` to the Fastify server; see `Dockerfile`, `nginx.conf`, `docker-compose.yml`
- **Vercel**: static output `dist/` (`vercel.json`)

## Path Aliases

```
@/        → src/
@shared/  → src/types/shared
@opencc/  → native/ferrous-opencc-wasm/pkg
```

## Code Conventions

- **Language**: Comments and commit messages in Chinese
- **Vue**: Composition API with `<script setup>`, TypeScript throughout
- **Auto-imports**: Vue, vue-router, @vueuse/core, and naive-ui composables are auto-imported (no explicit imports needed)
- **Naive UI components**: Auto-resolved via `unplugin-vue-components`
- **Unused variables**: Prefix with `_` to suppress lint warnings
- **Prettier**: Double quotes, trailing commas, 2-space indent, 100 char width
- **Workers**: Heavy computation (audio analysis) runs in a web worker (`src/core/audio-player/ffmpeg-engine/ffmpeg.worker.ts`)
- **TypeScript**: Composite project — `tsconfig.web.json` (renderer, extends @electron-toolkit/tsconfig) and `tsconfig.server.json` (server)
