use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub artist_id: Option<String>,
    pub album: Option<String>,
    pub album_id: Option<String>,
    pub duration_secs: u64,
    pub thumbnail: String,
    pub is_explicit: bool,
    pub like_status: Option<String>, // "LIKE" | "DISLIKE" | "INDIFFERENT"
    pub loudness_db: Option<f32>,
    pub local_path: Option<String>,
    pub is_downloaded: bool,
    pub codec: Option<String>,
    pub bitrate_kbps: Option<u32>,
    pub set_video_id: Option<String>, // Used for removing tracks from playlists
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub kind: String, // "song" | "album" | "playlist" | "artist" | "video"
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub thumbnail: String,
    pub duration_secs: Option<u64>,
    pub artist_id: Option<String>,
    pub album_id: Option<String>,
    pub is_explicit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub title: String,
    pub strapline: Option<String>,
    pub kind: String, // "quick_picks" | "carousel" | "list"
    pub items: Vec<ShelfItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodChip {
    pub title: String,
    pub params: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeResponse {
    pub chips: Vec<MoodChip>,
    pub shelves: Vec<Shelf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreResponse {
    pub moods: Vec<MoodChip>,
    pub shelves: Vec<Shelf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query: String,
    pub filter: String,
    pub top_result: Option<ShelfItem>,
    pub shelves: Vec<Shelf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    pub browse_id: String,
    pub name: String,
    pub description: Option<String>,
    pub subscribers: Option<String>,
    pub subscribed: bool,
    pub channel_id: Option<String>,
    pub thumbnail: String,
    pub top_songs: Vec<Track>,
    pub shelves: Vec<Shelf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub description: Option<String>,
    pub thumbnail: String,
    pub track_count: usize,
    pub total_duration_text: Option<String>,
    pub is_album: bool,
    pub is_local: bool,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedLyricLine {
    pub time_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsData {
    pub video_id: String,
    pub source: String,
    pub plain: Option<String>,
    pub synced: Vec<SyncedLyricLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchPlaylistResponse {
    pub tracks: Vec<Track>,
    pub lyrics_browse_id: Option<String>,
    pub related_browse_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub logged_in: bool,
    pub name: Option<String>,
    pub handle: Option<String>,
    pub avatar_url: Option<String>,
    pub is_premium: bool,
    pub auth_source: String, // "none" | "webview" | "cookies_file"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    pub ytdlp_installed: bool,
    pub ytdlp_path: Option<String>,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_installed: bool,
    pub ffmpeg_path: Option<String>,
    pub ffmpeg_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub sample_rates: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTelemetry {
    pub codec: String,
    pub bitrate_kbps: u32,
    pub source_sample_rate: u32,
    pub output_sample_rate: u32,
    pub channels: u16,
    pub output_device: String,
    pub exclusive_mode: bool,
    pub loudness_gain_db: f32,
    pub is_local_file: bool,
    pub format_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    pub is_playing: bool,
    pub is_loading: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub buffered_ratio: f32,
    pub volume: f32,
    pub muted: bool,
    pub current_track: Option<Track>,
    pub telemetry: Option<AudioTelemetry>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub thumbnail: String,
    pub duration_secs: u64,
    pub status: String, // "queued" | "downloading" | "processing" | "completed" | "paused" | "failed" | "cancelled"
    pub progress: f32,  // 0.0..100.0
    pub speed: String,
    pub eta: String,
    pub format: String,
    pub file_path: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EqSettings {
    pub enabled: bool,
    pub preset: String,
    pub preamp_db: f32,
    pub balance: f32,      // -1.0 (L) to +1.0 (R)
    pub bands: [f32; 10],  // 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz (-12..+12 dB)
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preset: "Flat".to_string(),
            preamp_db: 0.0,
            balance: 0.0,
            bands: [0.0; 10],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassSettings {
    #[serde(default = "default_true")]
    pub liquid_glass_enabled: bool,
    pub theme_mode: String,       // "adaptive" | "obsidian" | "frosted_light" | "oled" | "aurora"
    pub blur_px: u32,             // 0..60
    pub opacity: f32,             // 0.10..0.95
    pub saturation: u32,          // 100..220
    pub specular_strength: f32,   // 0.0..1.0
    pub border_radius: u32,       // 6..28
    pub mesh_speed: f32,          // 0.0..2.0
    pub accent_auto: bool,
    pub accent_color: String,     // HEX
    #[serde(default)]
    pub custom_colors_enabled: bool,
    #[serde(default = "default_bg_color")]
    pub bg_color: String,
    #[serde(default = "default_surface_color")]
    pub surface_color: String,
    #[serde(default = "default_text_color")]
    pub text_color: String,
    #[serde(default = "default_muted_text_color")]
    pub muted_text_color: String,
    pub density: String,          // "compact" | "default" | "cozy"
    pub sidebar_mode: String,     // "expanded" | "rail"
    pub cursor_refraction: bool,
    pub custom_css: String,
}

fn default_true() -> bool {
    true
}
fn default_bg_color() -> String {
    "#0d0f14".to_string()
}
fn default_surface_color() -> String {
    "#161922".to_string()
}
fn default_text_color() -> String {
    "#f4f4f5".to_string()
}
fn default_muted_text_color() -> String {
    "#a1a1aa".to_string()
}

impl Default for GlassSettings {
    fn default() -> Self {
        Self {
            liquid_glass_enabled: true,
            theme_mode: "obsidian".to_string(),
            blur_px: 20,
            opacity: 0.62,
            saturation: 140,
            specular_strength: 0.45,
            border_radius: 12,
            mesh_speed: 0.4,
            accent_auto: false,
            accent_color: "#e11d48".to_string(),
            custom_colors_enabled: false,
            bg_color: default_bg_color(),
            surface_color: default_surface_color(),
            text_color: default_text_color(),
            muted_text_color: default_muted_text_color(),
            density: "default".to_string(),
            sidebar_mode: "expanded".to_string(),
            cursor_refraction: false,
            custom_css: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub output_device: Option<String>,
    pub exclusive_mode: bool,
    pub streaming_quality: String, // "maximum" | "high" | "normal" | "saver"
    pub gapless: bool,
    pub crossfade_secs: f32,       // 0.0..8.0
    pub normalize_loudness: bool,
    pub target_lufs: f32,          // -23.0..-9.0 (default -14.0)
    pub limiter_enabled: bool,
    #[serde(default = "default_one_f32")]
    pub playback_speed: f32,       // 0.5..2.0
    #[serde(default = "default_true")]
    pub preserve_pitch: bool,
    #[serde(default)]
    pub visualizer_enabled: bool,
    #[serde(default)]
    pub sponsorblock_enabled: bool,
    pub eq: EqSettings,
}

fn default_one_f32() -> f32 {
    1.0
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            output_device: None,
            exclusive_mode: false,
            streaming_quality: "maximum".to_string(),
            gapless: true,
            crossfade_secs: 0.0,
            normalize_loudness: true,
            target_lufs: -14.0,
            limiter_enabled: true,
            playback_speed: 1.0,
            preserve_pitch: true,
            visualizer_enabled: false,
            sponsorblock_enabled: false,
            eq: EqSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettings {
    pub directory: String,
    pub filename_template: String, // "{artist} - {title}"
    pub format: String,            // "original" | "opus" | "m4a" | "mp3" | "flac"
    pub embed_thumbnail: bool,
    pub embed_lyrics: bool,
    pub max_concurrent: u32,       // 1..5
    pub smart_downloads: bool,
    pub smart_playlist_ids: Vec<String>,
    pub max_cache_mb: u64,         // 512..20480
    pub offline_mode: bool,
    #[serde(default)]
    pub local_music_folders: Vec<String>,
}

impl Default for DownloadSettings {
    fn default() -> Self {
        Self {
            directory: String::new(),
            filename_template: "{artist}/{album}/{title}".to_string(),
            format: "original".to_string(),
            embed_thumbnail: true,
            embed_lyrics: true,
            max_concurrent: 3,
            smart_downloads: false,
            smart_playlist_ids: vec!["LM".to_string()],
            max_cache_mb: 4096,
            offline_mode: false,
            local_music_folders: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub glass: GlassSettings,
    pub audio: AudioSettings,
    pub downloads: DownloadSettings,
    pub report_history: bool,
    pub minimize_to_tray: bool,
    pub auto_update_ytdlp: bool,
    #[serde(default = "default_true")]
    pub media_keys_enabled: bool,
    #[serde(default)]
    pub discord_rpc_enabled: bool,
    #[serde(default = "default_true")]
    pub global_hotkeys_enabled: bool,
    #[serde(default = "default_true")]
    pub restore_session: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            glass: GlassSettings::default(),
            audio: AudioSettings::default(),
            downloads: DownloadSettings::default(),
            report_history: true,
            minimize_to_tray: false,
            auto_update_ytdlp: true,
            media_keys_enabled: true,
            discord_rpc_enabled: false,
            global_hotkeys_enabled: true,
            restore_session: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub used_bytes: u64,
    pub file_count: usize,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlaylistSummary {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub thumbnail: Option<String>,
    pub track_count: usize,
    pub is_synced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopTrackStat {
    pub track: Track,
    pub play_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopArtistStat {
    pub artist: String,
    pub artist_id: Option<String>,
    pub thumbnail: String,
    pub play_count: u64,
    pub total_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyListeningStat {
    pub day_label: String,
    pub plays: u64,
    pub minutes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStats {
    pub total_plays: u64,
    pub total_minutes: u64,
    pub unique_tracks: u64,
    pub unique_artists: u64,
    pub streak_days: u64,
    pub top_tracks: Vec<TopTrackStat>,
    pub top_artists: Vec<TopArtistStat>,
    pub hourly_plays: Vec<u64>, // length 24
    pub daily_plays: Vec<DailyListeningStat>, // last 7 days
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSessionState {
    pub queue: Vec<Track>,
    pub queue_index: i32,
    pub position_ms: u64,
    pub shuffle: bool,
    pub repeat_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SponsorSegment {
    pub start_secs: f64,
    pub end_secs: f64,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    pub release_notes: String,
}
