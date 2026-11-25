export interface Track {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string | null;
  album?: string | null;
  albumId?: string | null;
  durationSecs: number;
  thumbnail: string;
  isExplicit: boolean;
  likeStatus?: string | null;
  loudnessDb?: number | null;
  localPath?: string | null;
  isDownloaded: boolean;
  codec?: string | null;
  bitrateKbps?: number | null;
  setVideoId?: string | null;
}

export interface ShelfItem {
  kind: "song" | "album" | "playlist" | "artist" | "video" | string;
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  durationSecs?: number | null;
  artistId?: string | null;
  albumId?: string | null;
  isExplicit: boolean;
}

export interface Shelf {
  title: string;
  strapline?: string | null;
  kind: "quick_picks" | "carousel" | "list" | string;
  items: ShelfItem[];
}

export interface MoodChip {
  title: string;
  params: string;
}

export interface HomeResponse {
  chips: MoodChip[];
  shelves: Shelf[];
}

export interface ExploreResponse {
  moods: MoodChip[];
  shelves: Shelf[];
}

export interface SearchResponse {
  query: string;
  filter: string;
  topResult?: ShelfItem | null;
  shelves: Shelf[];
}

export interface ArtistDetail {
  browseId: string;
  name: string;
  description?: string | null;
  subscribers?: string | null;
  subscribed: boolean;
  channelId?: string | null;
  thumbnail: string;
  topSongs: Track[];
  shelves: Shelf[];
}

export interface PlaylistDetail {
  id: string;
  title: string;
  subtitle: string;
  description?: string | null;
  thumbnail: string;
  trackCount: number;
  totalDurationText?: string | null;
  isAlbum: boolean;
  isLocal: boolean;
  tracks: Track[];
}

export interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsData {
  videoId: string;
  source: string;
  plain?: string | null;
  synced: SyncedLyricLine[];
}

export interface WatchPlaylistResponse {
  tracks: Track[];
  lyricsBrowseId?: string | null;
  relatedBrowseId?: string | null;
}

export interface AccountInfo {
  loggedIn: boolean;
  name?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  isPremium: boolean;
  authSource: string;
}

export interface BinaryStatus {
  ytdlpInstalled: boolean;
  ytdlpPath?: string | null;
  ytdlpVersion?: string | null;
  ffmpegInstalled: boolean;
  ffmpegPath?: string | null;
  ffmpegVersion?: string | null;
}

export interface AudioDeviceInfo {
  name: string;
  isDefault: boolean;
  sampleRates: number[];
}

export interface AudioTelemetry {
  codec: string;
  bitrateKbps: number;
  sourceSampleRate: number;
  outputSampleRate: number;
  channels: number;
  outputDevice: string;
  exclusiveMode: boolean;
  loudnessGainDb: number;
  isLocalFile: boolean;
  formatId?: string | null;
}

export interface PlaybackSnapshot {
  isPlaying: boolean;
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
  bufferedRatio: number;
  volume: number;
  muted: boolean;
  currentTrack?: Track | null;
  telemetry?: AudioTelemetry | null;
  error?: string | null;
}

export interface DownloadItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  album?: string | null;
  thumbnail: string;
  durationSecs: number;
  status: string;
  progress: number;
  speed: string;
  eta: string;
  format: string;
  filePath?: string | null;
  error?: string | null;
  createdAt: number;
}

export interface EqSettings {
  enabled: boolean;
  preset: string;
  preampDb: number;
  balance: number;
  bands: number[];
}

export interface GlassSettings {
  themeMode: "adaptive" | "obsidian" | "frosted_light" | "oled" | "aurora" | string;
  blurPx: number;
  opacity: number;
  saturation: number;
  specularStrength: number;
  borderRadius: number;
  meshSpeed: number;
  accentAuto: boolean;
  accentColor: string;
  density: "compact" | "default" | "cozy" | string;
  sidebarMode: "expanded" | "rail" | string;
  cursorRefraction: boolean;
  customCss: string;
}

export interface AudioSettings {
  outputDevice?: string | null;
  exclusiveMode: boolean;
  streamingQuality: "maximum" | "high" | "normal" | "saver" | string;
  gapless: boolean;
  crossfadeSecs: number;
  normalizeLoudness: boolean;
  targetLufs: number;
  limiterEnabled: boolean;
  eq: EqSettings;
}

export interface DownloadSettings {
  directory: string;
  filenameTemplate: string;
  format: "original" | "opus" | "m4a" | "mp3" | "flac" | string;
  embedThumbnail: boolean;
  embedLyrics: boolean;
  maxConcurrent: number;
  smartDownloads: boolean;
  smartPlaylistIds: string[];
  maxCacheMb: number;
  offlineMode: boolean;
}

export interface AppSettings {
  glass: GlassSettings;
  audio: AudioSettings;
  downloads: DownloadSettings;
  reportHistory: boolean;
  minimizeToTray: boolean;
  autoUpdateYtdlp: boolean;
}

export interface CacheStats {
  usedBytes: number;
  fileCount: number;
  maxBytes: number;
}

export interface LocalPlaylistSummary {
  id: string;
  title: string;
  description?: string | null;
  thumbnail?: string | null;
  trackCount: number;
  isSynced: boolean;
}

export type Route =
  | { page: "home" }
  | { page: "explore" }
  | { page: "search"; query: string; filter: string }
  | { page: "library"; tab?: "playlists" | "liked" | "downloads" | "history" }
  | { page: "downloads" }
  | { page: "settings"; tab?: "appearance" | "audio" | "downloads" | "account" }
  | { page: "playlist"; id: string; isLocal?: boolean }
  | { page: "artist"; browseId: string };

export const EQ_LABELS = [
  "31",
  "62",
  "125",
  "250",
  "500",
  "1k",
  "2k",
  "4k",
  "8k",
  "16k",
];

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Bass Boost": [6, 5, 3.5, 1.5, 0, 0, 0.5, 1, 1.5, 1],
  "Studio Reference": [0.5, 0.5, 0, 0, -0.5, 0, 0.5, 1, 1.5, 1],
  "Vocal Clarity": [-2, -1.5, -0.5, 1, 3, 4, 3.5, 2, 0.5, -1],
  Electronic: [5, 4, 1.5, 0, -1.5, 0.5, 2, 3.5, 4.5, 4],
  Rock: [4, 3, 1.5, -1, -2, -0.5, 2, 3.5, 4, 3.5],
  "Late Night": [3.5, 2.5, 1, 0, -1, -0.5, 0.5, 1.5, 2, 1],
  Acoustic: [2, 1.5, 1, 0.5, 1, 1, 2, 2.5, 2, 1.5],
};

export const DEFAULT_SETTINGS: AppSettings = {
  glass: {
    themeMode: "adaptive",
    blurPx: 28,
    opacity: 0.42,
    saturation: 165,
    specularStrength: 0.72,
    borderRadius: 18,
    meshSpeed: 1.0,
    accentAuto: true,
    accentColor: "#ff4d6d",
    density: "default",
    sidebarMode: "expanded",
    cursorRefraction: true,
    customCss: "",
  },
  audio: {
    outputDevice: null,
    exclusiveMode: false,
    streamingQuality: "maximum",
    gapless: true,
    crossfadeSecs: 0,
    normalizeLoudness: true,
    targetLufs: -14,
    limiterEnabled: true,
    eq: {
      enabled: false,
      preset: "Flat",
      preampDb: 0,
      balance: 0,
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  },
  downloads: {
    directory: "",
    filenameTemplate: "{artist}/{album}/{title}",
    format: "original",
    embedThumbnail: true,
    embedLyrics: true,
    maxConcurrent: 3,
    smartDownloads: false,
    smartPlaylistIds: ["LM"],
    maxCacheMb: 4096,
    offlineMode: false,
  },
  reportHistory: true,
  minimizeToTray: false,
  autoUpdateYtdlp: true,
};
