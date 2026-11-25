# LiquidYTM — Lightweight Audiophile YouTube Music Desktop Client

A lightweight, high-resolution **YouTube Music** desktop client built in **Rust + Tauri v2**, powered by **Direct InnerTube (`WEB_REMIX`)**, **`yt-dlp` + `FFmpeg`**, a **pure-Rust audiophile DSP & playback engine**, and a deeply customizable **Apple-style Liquid Glass UI**.

---

## Key Features

### 1. Pure-Rust Audiophile Sound Quality (Zero Browser `<audio>`)
- **Pure-Rust Decoding (`symphonia 0.6` + `symphonia-opus`)**: Decodes Opus (WebM/Ogg), AAC (M4A), FLAC, ALAC, MP3, Vorbis, and WAV natively in Rust without browser resampling.
- **Premium 256kbps Priority**: Automatically prefers YouTube Music Premium formats **`774` (Opus 256kbps)** and **`141` (AAC 256kbps)** when signed in, falling back to `251` (Opus) / `140` (AAC).
- **Direct OS Output (`cpal`)**: Matches source sample rate when supported by your DAC/audio interface; uses an **8-tap Blackman-windowed sinc resampler** when resampling is required.
- **Real-Time 10-Band Parametric Equalizer (`biquad`)**: Live 31Hz–16kHz peaking filters + Preamp + Stereo Balance + 8 Presets.
- **Loudness Normalization & Protection**: Uses YouTube's `loudnessDb` metadata targeting configurable LUFS (default `-14.0 LUFS`) with a transparent **soft-knee true-peak limiter**.
- **Progressive Disk-Cached Streaming**: Remote audio starts playing immediately while buffering into an LRU disk cache (`%LOCALAPPDATA%/LiquidYTM/audio_cache`) for glitch-free seeking and instant replays.
- **Live Audio Signal Path Telemetry**: Inspect codec, bitrate, format ID, source → output sample rate, device, and normalization gain in real time.

### 2. Full YouTube Music Experience & Account Login
- **Native Account Sign-In**: Sign in via the embedded YouTube Music WebView window (or import `cookies.txt` / raw Cookie header). Credentials are stored in the OS credential store (`keyring`) and signed via `SAPISIDHASH`.
- **Views**: Home (Mood chips, Quick Picks, Carousels), Explore (Charts, New Releases, Moods & Genres), Instant Search + Suggestions (Songs/Videos/Albums/Artists/Playlists), Artist pages, Album & Playlist pages, Library (Synced + Local playlists, Liked Music, Downloads, History).
- **Now Playing Drawer**: **Up Next** (Autoplay Radio + queue control), **Time-Synced Lyrics** (LRCLIB `.lrc` click-to-seek + YouTube Music lyrics fallback), and **Related**.
- **Downloads & Offline Mode**: Parallel `yt-dlp` download queue with live progress/speed/ETA, Original Best / Opus / M4A / MP3 320k / FLAC export, `lofty` metadata & album art embedding, custom filename templates, Smart Downloads sync, and Offline Mode.

### 3. Customizable Liquid Glass Design
- Native OS window translucency (`window-vibrancy` Acrylic/Mica on Windows, HUD vibrancy on macOS).
- Adaptive album-art color extraction driving an ambient animated mesh gradient behind multi-layered frosted glass surfaces with specular rim highlights and cursor light refraction.
- **Live Settings**: Theme presets (*Adaptive*, *Obsidian*, *Frosted Light*, *OLED*, *Aurora*), Blur radius, Frost opacity, Saturation, Specular highlight strength, Corner roundness, Mesh animation speed, Auto/Manual Accent color, Layout density, Sidebar mode, and Custom CSS.

---

## Development & Running

```bash
# Install frontend dependencies
npm install

# Run in development mode (launches native desktop window)
npm run tauri dev

# Build production installer
npm run tauri build

# Run Rust unit tests
cargo test --manifest-path src-tauri/Cargo.toml
```

### Keyboard Shortcuts
- `Space` — Play / Pause
- `Left` / `Right` — Seek -5s / +5s
- `M` — Mute / Unmute
- `Ctrl + K` — Spotlight Command Palette
