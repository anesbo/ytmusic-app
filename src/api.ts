import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AccountInfo,
  AppSettings,
  ArtistDetail,
  AudioDeviceInfo,
  BinaryStatus,
  CacheStats,
  DownloadItem,
  ExploreResponse,
  HomeResponse,
  LocalPlaylistSummary,
  LogEntry,
  LyricsData,
  PlaybackSnapshot,
  PlaylistDetail,
  SearchResponse,
  Shelf,
  ShelfItem,
  Track,
  WatchPlaylistResponse,
} from "./types";

export const api = {
  // Diagnostic Logs
  getLogs: () => invoke<LogEntry[]>("get_logs"),
  clearLogs: () => invoke<void>("clear_logs"),
  exportLogs: () => invoke<[string, string]>("export_logs"),
  logFrontendEvent: (level: string, scope: string, message: string) =>
    invoke<void>("log_frontend_event", { level, scope, message }),

  // Settings & Cache
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),
  getCacheStats: () => invoke<CacheStats>("get_cache_stats"),
  clearAudioCache: () => invoke<CacheStats>("clear_audio_cache"),

  // Binaries
  getBinaryStatus: () => invoke<BinaryStatus>("get_binary_status"),
  installOrUpdateYtdlp: () => invoke<string>("install_or_update_ytdlp"),

  // Auth
  getAccountInfo: () => invoke<AccountInfo>("get_account_info"),
  openYtMusicLogin: () => invoke<void>("open_ytmusic_login"),
  finishYtMusicLogin: () => invoke<AccountInfo>("finish_ytmusic_login"),
  importCookiesText: (content: string) => invoke<AccountInfo>("import_cookies_text", { content }),
  logoutAccount: () => invoke<AccountInfo>("logout_account"),

  // YouTube Music Browsing
  getHome: (moodParams?: string) =>
    invoke<HomeResponse>("ytm_get_home", { moodParams: moodParams || null }),
  getExplore: () => invoke<ExploreResponse>("ytm_get_explore"),
  search: (query: string, filter: string) =>
    invoke<SearchResponse>("ytm_search", { query, filter }),
  searchSuggestions: (query: string) =>
    invoke<string[]>("ytm_search_suggestions", { query }),
  getArtist: (browseId: string) => invoke<ArtistDetail>("ytm_get_artist", { browseId }),
  getPlaylist: (playlistId: string) => invoke<PlaylistDetail>("ytm_get_playlist", { playlistId }),
  getWatchPlaylist: (videoId: string, playlistId?: string) =>
    invoke<WatchPlaylistResponse>("ytm_get_watch_playlist", {
      videoId,
      playlistId: playlistId || null,
    }),
  getRelated: (browseId: string) => invoke<Shelf[]>("ytm_get_related", { browseId }),
  getLyrics: (
    videoId: string,
    title: string,
    artist: string,
    durationSecs: number,
    lyricsBrowseId?: string | null
  ) =>
    invoke<LyricsData>("ytm_get_lyrics", {
      videoId,
      title,
      artist,
      durationSecs,
      lyricsBrowseId: lyricsBrowseId || null,
    }),
  getLibraryPlaylists: () => invoke<ShelfItem[]>("ytm_get_library_playlists"),
  getLikedSongs: () => invoke<PlaylistDetail>("ytm_get_liked_songs"),
  rateSong: (track: Track, rating: "LIKE" | "DISLIKE" | "INDIFFERENT") =>
    invoke<void>("ytm_rate_song", { track, rating }),
  subscribeArtist: (channelId: string, subscribe: boolean) =>
    invoke<void>("ytm_subscribe_artist", { channelId, subscribe }),
  createPlaylist: (title: string, description: string, synced: boolean) =>
    invoke<string>("ytm_create_playlist", { title, description, synced }),
  addToPlaylist: (playlistId: string, track: Track) =>
    invoke<void>("ytm_add_to_playlist", { playlistId, track }),

  // Local Library
  listLocalPlaylists: () => invoke<LocalPlaylistSummary[]>("list_local_playlists"),
  getLocalPlaylist: (playlistId: string) =>
    invoke<PlaylistDetail>("get_local_playlist", { playlistId }),
  removeFromLocalPlaylist: (playlistId: string, videoId: string) =>
    invoke<void>("remove_from_local_playlist", { playlistId, videoId }),
  deleteLocalPlaylist: (playlistId: string) =>
    invoke<void>("delete_local_playlist", { playlistId }),
  getDownloadedTracks: () => invoke<Track[]>("get_downloaded_tracks"),
  getRecentHistory: (limit = 50) => invoke<Track[]>("get_recent_history", { limit }),

  // Pure-Rust Audio Engine
  listAudioDevices: () => invoke<AudioDeviceInfo[]>("list_audio_devices"),
  playTrack: (track: Track) => invoke<PlaybackSnapshot>("play_track", { track }),
  preloadTrack: (videoId: string) => invoke<void>("preload_track", { videoId }),
  pausePlayback: () => invoke<PlaybackSnapshot>("pause_playback"),
  resumePlayback: () => invoke<PlaybackSnapshot>("resume_playback"),
  togglePlayback: () => invoke<PlaybackSnapshot>("toggle_playback"),
  seekPlayback: (positionMs: number) => invoke<PlaybackSnapshot>("seek_playback", { positionMs }),
  setVolume: (volume: number) => invoke<PlaybackSnapshot>("set_volume", { volume }),
  setMuted: (muted: boolean) => invoke<PlaybackSnapshot>("set_muted", { muted }),
  stopPlayback: () => invoke<PlaybackSnapshot>("stop_playback"),
  getPlaybackSnapshot: () => invoke<PlaybackSnapshot>("get_playback_snapshot"),

  // Downloads
  enqueueDownload: (track: Track) => invoke<DownloadItem>("enqueue_download", { track }),
  enqueueBatchDownload: (tracks: Track[]) =>
    invoke<DownloadItem[]>("enqueue_batch_download", { tracks }),
  listDownloads: () => invoke<DownloadItem[]>("list_downloads"),
  cancelDownload: (downloadId: string) => invoke<void>("cancel_download", { downloadId }),
  removeDownload: (downloadId: string, deleteFile: boolean) =>
    invoke<void>("remove_download", { downloadId, deleteFile }),
  syncSmartDownloads: () => invoke<number>("sync_smart_downloads"),

  // Events
  onPlaybackState: (cb: (snap: PlaybackSnapshot) => void): Promise<UnlistenFn> =>
    listen<PlaybackSnapshot>("playback-state", (e) => cb(e.payload)),
  onTrackEnded: (cb: () => void): Promise<UnlistenFn> =>
    listen("track-ended", () => cb()),
  onDownloadUpdated: (cb: (item: DownloadItem) => void): Promise<UnlistenFn> =>
    listen<DownloadItem>("download-updated", (e) => cb(e.payload)),
};

export function shelfItemToTrack(item: ShelfItem): Track {
  const parts = item.subtitle
    .split(" • ")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !/^(song|video)$/i.test(s) &&
        !/\b(plays|views)\b/i.test(s) &&
        !/^\d+:\d+(:\d+)?$/.test(s)
    );
  return {
    videoId: item.id,
    title: item.title,
    artist: parts[0] || "Unknown Artist",
    artistId: item.artistId ?? null,
    album: parts[1] ?? null,
    albumId: item.albumId ?? null,
    durationSecs: item.durationSecs ?? 0,
    thumbnail: item.thumbnail,
    isExplicit: item.isExplicit,
    likeStatus: null,
    loudnessDb: null,
    localPath: null,
    isDownloaded: false,
    codec: null,
    bitrateKbps: null,
    setVideoId: null,
  };
}

export function formatTime(ms: number): string {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Extracts 3 vibrant ambient colors + 1 accent color from an album art URL using offscreen canvas.
 * Falls back gracefully if CORS blocks pixel reads.
 */
export async function extractArtworkPalette(
  imageUrl: string
): Promise<{ c1: string; c2: string; c3: string; accent: string } | null> {
  if (!imageUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;

        const buckets: Array<{ r: number; g: number; b: number; sat: number; lum: number }> = [];
        for (let i = 0; i < data.length; i += 16) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          if (lum > 0.1 && lum < 0.92) {
            buckets.push({ r, g, b, sat, lum });
          }
        }
        if (buckets.length < 3) return resolve(null);
        buckets.sort((a, b) => b.sat - a.sat);
        const p1 = buckets[0];
        const p2 = buckets[Math.floor(buckets.length * 0.25)];
        const p3 = buckets[Math.floor(buckets.length * 0.6)];

        const boost = (c: { r: number; g: number; b: number }) => {
          const hex = (v: number) => Math.min(255, Math.max(25, Math.round(v))).toString(16).padStart(2, "0");
          return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
        };

        resolve({
          c1: `rgb(${p1.r}, ${p1.g}, ${p1.b})`,
          c2: `rgb(${p2.r}, ${p2.g}, ${p2.b})`,
          c3: `rgb(${p3.r}, ${p3.g}, ${p3.b})`,
          accent: boost({
            r: Math.min(255, p1.r * 1.15 + 24),
            g: Math.min(255, p1.g * 1.15 + 24),
            b: Math.min(255, p1.b * 1.15 + 24),
          }),
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}
