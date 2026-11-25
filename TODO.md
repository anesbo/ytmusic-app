# LiquidYTM — Lightweight Rust YouTube Music Desktop Client

## Architecture Overview
- **Shell:** Tauri v2 (Rust backend + lightweight React/TypeScript Vite UI + `window-vibrancy` native translucency)
- **Audio Engine (Pure Rust — Zero browser `<audio>`):** `symphonia` (+ Opus support) -> `rubato` high-precision resampler -> `biquad` 10-band parametric EQ + ReplayGain/LUFS normalization + soft-knee true-peak limiter + gapless/crossfade mixer -> `cpal` (WASAPI / CoreAudio / PipeWire/ALSA)
- **YouTube Music Integration:** Direct Rust InnerTube (`WEB_REMIX`) API client with `SAPISIDHASH` authentication + embedded WebView Google/YT Music login + cookie import + OS Keyring secure storage
- **Media Extraction & Downloads:** Managed auto-updating `yt-dlp` + `ffmpeg` sidecar pipeline prioritizing Premium 256kbps (`774` Opus / `141` AAC) and `251` Opus / `140` AAC, with Smart Downloads, parallel worker pool, metadata/cover-art/lyrics embedding (`lofty`), and offline mode
- **UI & Customization:** Apple-style Liquid Glass visual engine (layered frosted blur, specular rim highlights, cursor light refraction, adaptive album-art mesh gradient) with live customization in Settings

## Phase Checklist
- [ ] **Phase 1: Project Scaffold, Database & Binary Manager**
  - [ ] Tauri v2 + Vite + React + TypeScript workspace
  - [ ] SQLite schema (`tracks`, `playlists`, `playlist_tracks`, `downloads`, `history`, `playback_state`, `settings`)
  - [ ] Auto-managed `yt-dlp` & `ffmpeg` discovery, download, and update manager
- [ ] **Phase 2: YouTube Music Account Login & InnerTube API Client**
  - [ ] Embedded WebView login (`music.youtube.com`) + Netscape `cookies.txt` import + OS keyring storage
  - [ ] `SAPISIDHASH` request signing & authenticated `WEB_REMIX` InnerTube client
  - [ ] Home, Explore, Charts, Moods, Search + Suggestions, Artist, Album, Playlist, Watch/Radio, Lyrics (+ LRCLIB synced fallback)
  - [ ] Account actions: Like/Dislike, Create/Edit Playlists, Add/Remove songs, Subscribe, Library sync
- [ ] **Phase 3: Pure-Rust Audiophile Audio & DSP Engine**
  - [ ] Progressive range-buffered streaming + local offline file playback via `symphonia` (+ Opus)
  - [ ] 10-band live EQ + Preamp + Balance + Presets (`biquad`)
  - [ ] Loudness normalization (`loudnessDb` / Target LUFS) + true-peak limiter
  - [ ] High-quality resampling (`rubato`), gapless pre-buffering, equal-power crossfade
  - [ ] Output device selection (`cpal`), live signal-path telemetry, OS media controls (`souvlaki`)
- [ ] **Phase 4: `yt-dlp` Resolver & Smart Download Manager**
  - [ ] Stream URL resolver with Premium (`774`/`141`) and Free (`251`/`140`) priority + auto re-resolve on expiry
  - [ ] Parallel download queue with pause/resume/cancel/retry + live progress events
  - [ ] Format options (Original Best, Opus, M4A, MP3 320k, FLAC), filename templates, `lofty` tagging, Smart Downloads, LRU cache, Offline Mode
- [ ] **Phase 5: Liquid Glass Design System & Complete YT Music UI**
  - [ ] Native window vibrancy + multi-layer Liquid Glass components + adaptive album-art gradient mesh
  - [ ] Full YT Music views: Home, Explore, Search, Library, Downloads, Artist, Album, Playlist, Now Playing (Up Next / Synced Lyrics / Related), Mini-Player, Command Palette (`Ctrl+K`)
  - [ ] Comprehensive Settings: Liquid Glass controls, Audio & 10-band EQ, Downloads & Cache, Account & Binaries, Custom CSS
- [ ] **Phase 6: Verification, Tests & Polish**
  - [ ] Rust unit tests (DSP/EQ/LUFS math, InnerTube parsing, `SAPISIDHASH`, SQLite migrations, filename templates)
  - [ ] TypeScript typecheck + production Vite build + `cargo test` + `cargo check` / `tauri build` verification
