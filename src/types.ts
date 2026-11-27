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
  liquidGlassEnabled: boolean;
  themeMode: "adaptive" | "obsidian" | "frosted_light" | "oled" | "aurora" | string;
  blurPx: number;
  opacity: number;
  saturation: number;
  specularStrength: number;
  borderRadius: number;
  meshSpeed: number;
  accentAuto: boolean;
  accentColor: string;
  customColorsEnabled: boolean;
  bgColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  density: "compact" | "default" | "cozy" | string;
  sidebarMode: "expanded" | "rail" | string;
  cursorRefraction: boolean;
  customCss: string;
  fontFamily: "system" | "geometric" | "editorial" | "mono" | "rounded" | string;
  uiScale: number;
  wallpaperPath: string;
  wallpaperBlur: number;
  wallpaperDim: number;
  playerBarStyle: "dock" | "flush" | "capsule" | string;
  hiddenSidebarItems: string[];
  zenMode: boolean;
  artShape: "soft" | "sharp" | "squircle" | "vinyl" | string;
  artGlow: boolean;
  nowPlayingLayout: "split" | "cinema" | "minimal" | string;
  glassGrain: number;
  borderStyle: "hairline" | "borderless" | "crisp" | string;
  miniPlayerSkin: "bar" | "square" | "pill" | string;
  miniWindowOpacity: number;
  hiddenHomeSections: string[];
  titlebarSearchMode: "full" | "compact" | string;
  loaderStyle: "snake" | "bars" | "orbit" | "pulse" | "dots" | "minimal" | string;
  autoScrollCarousels: boolean;
  ecoMode: boolean;
}

export interface ColorPreset {
  name: string;
  bgColor: string;
  surfaceColor: string;
  accentColor: string;
  textColor: string;
  mutedTextColor: string;
  themeMode: string;
  accentAuto?: boolean;
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    name: "Zinc Studio",
    bgColor: "#0c0d10",
    surfaceColor: "#15171c",
    accentColor: "#e11d48",
    textColor: "#f4f4f5",
    mutedTextColor: "#a1a1aa",
    themeMode: "obsidian",
  },
  {
    name: "Adaptive Artwork",
    bgColor: "#0c0d12",
    surfaceColor: "#161822",
    accentColor: "#e11d48",
    textColor: "#f4f4f5",
    mutedTextColor: "#a1a1aa",
    themeMode: "adaptive",
    accentAuto: true,
  },
  {
    name: "Midnight Slate",
    bgColor: "#0b1120",
    surfaceColor: "#131c31",
    accentColor: "#3b82f6",
    textColor: "#f1f5f9",
    mutedTextColor: "#94a3b8",
    themeMode: "obsidian",
  },
  {
    name: "Tokyo Night",
    bgColor: "#0f101a",
    surfaceColor: "#181a2a",
    accentColor: "#8b5cf6",
    textColor: "#eef0ff",
    mutedTextColor: "#9aa0c2",
    themeMode: "obsidian",
  },
  {
    name: "Rose Noir",
    bgColor: "#140b10",
    surfaceColor: "#21121a",
    accentColor: "#f43f5e",
    textColor: "#fdf2f8",
    mutedTextColor: "#b89aa8",
    themeMode: "obsidian",
  },
  {
    name: "Warm Espresso",
    bgColor: "#120f0d",
    surfaceColor: "#1c1714",
    accentColor: "#d97706",
    textColor: "#f5f0eb",
    mutedTextColor: "#a89f96",
    themeMode: "obsidian",
  },
  {
    name: "Forest Dark",
    bgColor: "#0a110e",
    surfaceColor: "#121d18",
    accentColor: "#10b981",
    textColor: "#ecfdf5",
    mutedTextColor: "#8ca89c",
    themeMode: "obsidian",
  },
  {
    name: "Oceanic Teal",
    bgColor: "#081217",
    surfaceColor: "#102029",
    accentColor: "#06b6d4",
    textColor: "#ecfeff",
    mutedTextColor: "#89aab5",
    themeMode: "obsidian",
  },
  {
    name: "Sunset Copper",
    bgColor: "#14100f",
    surfaceColor: "#201917",
    accentColor: "#ea580c",
    textColor: "#fff7ed",
    mutedTextColor: "#b59d92",
    themeMode: "obsidian",
  },
  {
    name: "Pure OLED",
    bgColor: "#000000",
    surfaceColor: "#0e0e11",
    accentColor: "#f43f5e",
    textColor: "#fafafa",
    mutedTextColor: "#8e8e93",
    themeMode: "oled",
  },
  {
    name: "Nordic Light",
    bgColor: "#eef1f6",
    surfaceColor: "#ffffff",
    accentColor: "#2563eb",
    textColor: "#111827",
    mutedTextColor: "#4b5563",
    themeMode: "frosted_light",
  },
  {
    name: "Warm Paper",
    bgColor: "#f5f2eb",
    surfaceColor: "#fffdf9",
    accentColor: "#b45309",
    textColor: "#1c1917",
    mutedTextColor: "#57534e",
    themeMode: "frosted_light",
  },
];

export interface AmbienceSettings {
  enabled: boolean;
  preset: "off" | "rainy_study" | "cozy_fireplace" | "ocean_breeze" | "focus_noise" | "custom" | string;
  rain: number;
  fireplace: number;
  ocean: number;
  brownNoise: number;
  thunder: number;
}

export interface AudioFxSettings {
  preset: "off" | "slowed_reverb" | "concert_hall" | "lofi_vinyl" | "8d_spatial" | "sub_bass" | string;
  reverbMix: number;
  spatial8d: boolean;
  lofiWarmth: boolean;
  monoDownmix: boolean;
  subBassBoost: number;
  vocalRemover: boolean;
  vocalRemoverStrength: number;
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
  playbackSpeed: number;
  preservePitch: boolean;
  pitchSemitones: number;
  autoDucking: boolean;
  duckLevel: number;
  autoPauseOnDeviceChange: boolean;
  autoResumeOnDeviceReconnect: boolean;
  visualizerEnabled: boolean;
  sponsorblockEnabled: boolean;
  fadeOnPause: boolean;
  trimSilence: boolean;
  waveformSeekbar: boolean;
  ambience: AmbienceSettings;
  fx: AudioFxSettings;
  deviceEqProfiles: Record<string, EqSettings>;
  playlistEqProfiles: Record<string, EqSettings>;
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
  localMusicFolders: string[];
}

export interface AppSettings {
  glass: GlassSettings;
  audio: AudioSettings;
  downloads: DownloadSettings;
  reportHistory: boolean;
  minimizeToTray: boolean;
  miniPlayerOnClose: boolean;
  autoUpdateYtdlp: boolean;
  mediaKeysEnabled: boolean;
  discordRpcEnabled: boolean;
  globalHotkeysEnabled: boolean;
  restoreSession: boolean;
  scrobbleEnabled: boolean;
  lastfmApiKey: string;
  lastfmApiSecret: string;
  lastfmSessionKey: string;
  listenbrainzToken: string;
  skipDisliked: boolean;
  blockedArtists: string[];
  blockedKeywords: string[];
}

export interface PinnedItem {
  kind: "playlist" | "artist" | "album" | "smart" | string;
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  isLocal?: boolean;
  smartKind?: string | null;
}

export interface SavedQueueSnapshot {
  id: string;
  name: string;
  queue: Track[];
  queueIndex: number;
  positionMs: number;
  createdAt: number;
}

export interface RadioStation {
  id: string;
  name: string;
  genre: string;
  url: string;
  thumbnail: string;
  isCustom?: boolean;
}

export interface TrackBookmark {
  id: number;
  videoId: string;
  timeMs: number;
  label: string;
}

export interface TopTrackStat {
  track: Track;
  playCount: number;
}

export interface TopArtistStat {
  artist: string;
  artistId?: string | null;
  thumbnail: string;
  playCount: number;
  totalSecs: number;
}

export interface DailyListeningStat {
  dayLabel: string;
  plays: number;
  minutes: number;
}

export interface HeatmapDayStat {
  date: string;
  label: string;
  plays: number;
  minutes: number;
}

export interface TopAlbumStat {
  album: string;
  artist: string;
  albumId?: string | null;
  thumbnail: string;
  playCount: number;
}

export interface ListeningStats {
  totalPlays: number;
  totalMinutes: number;
  uniqueTracks: number;
  uniqueArtists: number;
  streakDays: number;
  longestStreakDays: number;
  avgPlaysPerDay: number;
  peakHour: number;
  listeningPersona: string;
  discoveryRatePct: number;
  likedCount: number;
  downloadedCount: number;
  topTracks: TopTrackStat[];
  topArtists: TopArtistStat[];
  topAlbums: TopAlbumStat[];
  hourlyPlays: number[];
  dailyPlays: DailyListeningStat[];
  weekdayPlays: DailyListeningStat[];
  heatmapDays: HeatmapDayStat[];
}

export interface SavedSessionState {
  queue: Track[];
  queueIndex: number;
  positionMs: number;
  shuffle: boolean;
  repeatMode: "off" | "all" | "one" | string;
}

export interface SponsorSegment {
  startSecs: number;
  endSecs: number;
  category: string;
}

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseNotes: string;
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

export interface LogEntry {
  timestamp: string;
  level: string;
  scope: string;
  message: string;
}

export type Route =
  | { page: "home" }
  | { page: "explore" }
  | { page: "search"; query: string; filter: string }
  | { page: "library"; tab?: "playlists" | "liked" | "downloads" | "local" | "history" }
  | { page: "stats" }
  | { page: "radio" }
  | { page: "galaxy" }
  | { page: "downloads" }
  | { page: "settings"; tab?: "appearance" | "audio" | "desktop" | "downloads" | "account" | "logs" }
  | { page: "playlist"; id: string; isLocal?: boolean; smartKind?: string }
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
    liquidGlassEnabled: true,
    themeMode: "obsidian",
    blurPx: 20,
    opacity: 0.62,
    saturation: 140,
    specularStrength: 0.45,
    borderRadius: 12,
    meshSpeed: 0.4,
    accentAuto: false,
    accentColor: "#e11d48",
    customColorsEnabled: false,
    bgColor: "#0c0d10",
    surfaceColor: "#15171c",
    textColor: "#f4f4f5",
    mutedTextColor: "#a1a1aa",
    density: "default",
    sidebarMode: "expanded",
    cursorRefraction: false,
    customCss: "",
    fontFamily: "system",
    uiScale: 100,
    wallpaperPath: "",
    wallpaperBlur: 10,
    wallpaperDim: 0.45,
    playerBarStyle: "dock",
    hiddenSidebarItems: [],
    zenMode: false,
    artShape: "soft",
    artGlow: true,
    nowPlayingLayout: "split",
    glassGrain: 0.16,
    borderStyle: "hairline",
    miniPlayerSkin: "bar",
    miniWindowOpacity: 0.94,
    hiddenHomeSections: [],
    titlebarSearchMode: "full",
    loaderStyle: "snake",
    autoScrollCarousels: true,
    ecoMode: false,
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
    playbackSpeed: 1.0,
    preservePitch: true,
    pitchSemitones: 0,
    autoDucking: false,
    duckLevel: 0.25,
    autoPauseOnDeviceChange: true,
    autoResumeOnDeviceReconnect: false,
    visualizerEnabled: false,
    sponsorblockEnabled: false,
    fadeOnPause: true,
    trimSilence: false,
    waveformSeekbar: true,
    ambience: {
      enabled: false,
      preset: "off",
      rain: 0,
      fireplace: 0,
      ocean: 0,
      brownNoise: 0,
      thunder: 0,
    },
    fx: {
      preset: "off",
      reverbMix: 0,
      spatial8d: false,
      lofiWarmth: false,
      monoDownmix: false,
      subBassBoost: 0,
      vocalRemover: false,
      vocalRemoverStrength: 0.85,
    },
    deviceEqProfiles: {},
    playlistEqProfiles: {},
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
    localMusicFolders: [],
  },
  reportHistory: true,
  minimizeToTray: false,
  miniPlayerOnClose: false,
  autoUpdateYtdlp: true,
  mediaKeysEnabled: true,
  discordRpcEnabled: false,
  globalHotkeysEnabled: true,
  restoreSession: true,
  scrobbleEnabled: false,
  lastfmApiKey: "",
  lastfmApiSecret: "",
  lastfmSessionKey: "",
  listenbrainzToken: "",
  skipDisliked: true,
  blockedArtists: [],
  blockedKeywords: [],
};
