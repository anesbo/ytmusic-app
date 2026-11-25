pub mod audio;
pub mod auth;
pub mod binaries;
pub mod db;
pub mod downloads;
pub mod innertube;
pub mod logger;
pub mod models;
pub mod ytdlp;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::audio::source::AudioCache;
use crate::audio::{AudioEngine, PlayRequest};
use crate::auth::{AuthManager, StoredCookie};
use crate::binaries::BinaryManager;
use crate::db::Database;
use crate::downloads::DownloadManager;
use crate::innertube::InnerTubeClient;
use crate::models::{
    AccountInfo, AppSettings, ArtistDetail, AudioDeviceInfo, BinaryStatus, CacheStats,
    DownloadItem, ExploreResponse, HomeResponse, LocalPlaylistSummary, LyricsData,
    PlaybackSnapshot, PlaylistDetail, SearchResponse, Shelf, ShelfItem, Track,
    WatchPlaylistResponse,
};
use crate::ytdlp::YtDlpResolver;

pub struct AppState {
    pub db: Arc<Database>,
    pub binaries: Arc<BinaryManager>,
    pub auth: Arc<AuthManager>,
    pub innertube: Arc<InnerTubeClient>,
    pub ytdlp: Arc<YtDlpResolver>,
    pub cache: Arc<AudioCache>,
    pub audio: Arc<AudioEngine>,
    pub downloads: Arc<DownloadManager>,
    pub settings: Arc<RwLock<AppSettings>>,
}

// ============================================================================
// Diagnostic Logging Commands
// ============================================================================

#[tauri::command]
async fn get_logs() -> Result<Vec<logger::LogEntry>, String> {
    Ok(logger::get_entries())
}

#[tauri::command]
async fn clear_logs() -> Result<(), String> {
    logger::clear();
    Ok(())
}

#[tauri::command]
async fn log_frontend_event(level: String, scope: String, message: String) -> Result<(), String> {
    logger::log(&level, &scope, message);
    Ok(())
}

#[tauri::command]
async fn export_logs(state: State<'_, AppState>) -> Result<(String, String), String> {
    let bin = state.binaries.status().await;
    let acc = state.auth.account_info();
    let settings = state.settings.read().unwrap().clone();
    let snap = state.audio.snapshot();
    let devices = AudioEngine::list_output_devices();

    let summary = format!(
        "OS: {} ({})\nLogged In: {} (source: {}, premium: {})\nyt-dlp: {} ({:?})\nffmpeg: {} ({:?})\nLiquid Glass Enabled: {}\nStreaming Quality: {}\nAudio Devices: {}\nCurrent Playback Error: {:?}\nLog File: {:?}\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
        acc.logged_in,
        acc.auth_source,
        acc.is_premium,
        bin.ytdlp_installed,
        bin.ytdlp_version,
        bin.ffmpeg_installed,
        bin.ffmpeg_version,
        settings.glass.liquid_glass_enabled,
        settings.audio.streaming_quality,
        devices.iter().map(|d| d.name.as_str()).collect::<Vec<_>>().join(", "),
        snap.error,
        logger::log_file_path()
    );

    let full_text = logger::format_plain_text(&summary);

    let export_dir = dirs::desktop_dir()
        .or_else(dirs::download_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let export_path = export_dir.join(format!("liquidytm-log-{ts}.txt"));
    std::fs::write(&export_path, &full_text).map_err(|e| e.to_string())?;

    Ok((export_path.to_string_lossy().to_string(), full_text))
}

// ============================================================================
// Settings & Cache Commands
// ============================================================================

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    Ok(state.settings.read().unwrap().clone())
}

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    state.db.save_settings(&settings).map_err(|e| e.to_string())?;
    state.audio.update_audio_settings(settings.audio.clone());
    *state.settings.write().unwrap() = settings.clone();
    Ok(settings)
}

#[tauri::command]
async fn get_cache_stats(state: State<'_, AppState>) -> Result<CacheStats, String> {
    let max_mb = state.settings.read().unwrap().downloads.max_cache_mb;
    Ok(state.cache.stats(max_mb))
}

#[tauri::command]
async fn clear_audio_cache(state: State<'_, AppState>) -> Result<CacheStats, String> {
    state.cache.clear().map_err(|e| e.to_string())?;
    let max_mb = state.settings.read().unwrap().downloads.max_cache_mb;
    Ok(state.cache.stats(max_mb))
}

// ============================================================================
// Binary Management Commands (yt-dlp & ffmpeg)
// ============================================================================

#[tauri::command]
async fn get_binary_status(state: State<'_, AppState>) -> Result<BinaryStatus, String> {
    Ok(state.binaries.status().await)
}

#[tauri::command]
async fn install_or_update_ytdlp(state: State<'_, AppState>) -> Result<String, String> {
    state.binaries.update_ytdlp().await.map_err(|e| e.to_string())
}

// ============================================================================
// Account Authentication Commands
// ============================================================================

#[tauri::command]
async fn get_account_info(state: State<'_, AppState>) -> Result<AccountInfo, String> {
    if state.auth.is_logged_in() && state.auth.account_info().name.is_none() {
        let _ = state.innertube.fetch_account_profile().await;
    }
    Ok(state.auth.account_info())
}

#[tauri::command]
async fn open_ytmusic_login(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("ytm-login") {
        let _ = win.set_focus();
        return Ok(());
    }
    let url = url::Url::parse("https://music.youtube.com").map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, "ytm-login", WebviewUrl::External(url))
        .title("Sign in to YouTube Music — Click 'Complete Sign-In' in LiquidYTM once logged in")
        .inner_size(980.0, 720.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn finish_ytmusic_login(app: AppHandle, state: State<'_, AppState>) -> Result<AccountInfo, String> {
    let win = app
        .get_webview_window("ytm-login")
        .ok_or_else(|| "Login window is not open. Click 'Sign In with YouTube Music' first.".to_string())?;

    let mut collected: Vec<StoredCookie> = Vec::new();
    for target in [
        "https://music.youtube.com",
        "https://www.youtube.com",
    ] {
        if let Ok(parsed_url) = url::Url::parse(target) {
            if let Ok(cookies) = win.cookies_for_url(parsed_url) {
                for c in cookies {
                    let domain = c.domain().unwrap_or(".youtube.com").to_string();
                    let path = c.path().unwrap_or("/").to_string();
                    let secure = c.secure().unwrap_or(true);
                    let expires = chrono::Utc::now().timestamp() + 86400 * 180;
                    collected.push(StoredCookie {
                        domain,
                        path,
                        secure,
                        expires,
                        name: c.name().to_string(),
                        value: c.value().to_string(),
                    });
                }
            }
        }
    }

    logger::info(
        "auth",
        format!(
            "Captured {} WebView cookies (names: {})",
            collected.len(),
            collected
                .iter()
                .map(|c| c.name.as_str())
                .take(15)
                .collect::<Vec<_>>()
                .join(", ")
        ),
    );
    state
        .auth
        .set_cookies(collected, "webview")
        .map_err(|e| {
            logger::error("auth", format!("WebView cookie capture failed: {e}"));
            e.to_string()
        })?;

    let _ = win.close();
    let _ = state.innertube.fetch_account_profile().await;
    Ok(state.auth.account_info())
}

#[tauri::command]
async fn import_cookies_text(state: State<'_, AppState>, content: String) -> Result<AccountInfo, String> {
    let trimmed = content.trim();
    if trimmed.contains('\t') {
        state
            .auth
            .import_netscape_cookies(trimmed)
            .map_err(|e| e.to_string())?;
    } else {
        state
            .auth
            .import_raw_cookie_header(trimmed)
            .map_err(|e| e.to_string())?;
    }
    let _ = state.innertube.fetch_account_profile().await;
    Ok(state.auth.account_info())
}

#[tauri::command]
async fn logout_account(state: State<'_, AppState>) -> Result<AccountInfo, String> {
    state.auth.logout().map_err(|e| e.to_string())?;
    Ok(state.auth.account_info())
}

// ============================================================================
// InnerTube YouTube Music Browsing & Actions
// ============================================================================

#[tauri::command]
async fn ytm_get_home(state: State<'_, AppState>, mood_params: Option<String>) -> Result<HomeResponse, String> {
    state
        .innertube
        .get_home(mood_params.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_get_explore(state: State<'_, AppState>) -> Result<ExploreResponse, String> {
    state
        .innertube
        .get_explore()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_search(state: State<'_, AppState>, query: String, filter: String) -> Result<SearchResponse, String> {
    state
        .innertube
        .search(&query, &filter)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_search_suggestions(state: State<'_, AppState>, query: String) -> Result<Vec<String>, String> {
    state
        .innertube
        .get_search_suggestions(&query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_get_artist(state: State<'_, AppState>, browse_id: String) -> Result<ArtistDetail, String> {
    state
        .innertube
        .get_artist(&browse_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_get_playlist(state: State<'_, AppState>, playlist_id: String) -> Result<PlaylistDetail, String> {
    let mut detail = state
        .innertube
        .get_playlist(&playlist_id)
        .await
        .map_err(|e| e.to_string())?;

    // Hydrate local download status from SQLite
    for track in &mut detail.tracks {
        if let Ok(Some(saved)) = state.db.get_track(&track.video_id) {
            track.is_downloaded = saved.is_downloaded;
            track.local_path = saved.local_path;
            if track.like_status.is_none() {
                track.like_status = saved.like_status;
            }
        }
    }
    apply_saved_playlist_order(&state.db, &playlist_id, &mut detail.tracks);
    Ok(detail)
}

#[tauri::command]
async fn ytm_get_watch_playlist(
    state: State<'_, AppState>,
    video_id: String,
    playlist_id: Option<String>,
) -> Result<WatchPlaylistResponse, String> {
    state
        .innertube
        .get_watch_playlist(&video_id, playlist_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_get_related(state: State<'_, AppState>, browse_id: String) -> Result<Vec<Shelf>, String> {
    state
        .innertube
        .get_related(&browse_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_get_lyrics(
    state: State<'_, AppState>,
    video_id: String,
    title: String,
    artist: String,
    duration_secs: u64,
    lyrics_browse_id: Option<String>,
) -> Result<LyricsData, String> {
    state
        .innertube
        .get_lyrics(
            &video_id,
            &title,
            &artist,
            duration_secs,
            lyrics_browse_id.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_get_library_playlists(state: State<'_, AppState>) -> Result<Vec<ShelfItem>, String> {
    state
        .innertube
        .get_library_playlists()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_get_liked_songs(state: State<'_, AppState>) -> Result<PlaylistDetail, String> {
    if state.auth.is_logged_in() {
        if let Ok(mut remote) = state.innertube.get_liked_songs().await {
            for t in &mut remote.tracks {
                t.like_status = Some("LIKE".to_string());
                if let Ok(Some(saved)) = state.db.get_track(&t.video_id) {
                    t.is_downloaded = saved.is_downloaded;
                    t.local_path = saved.local_path;
                }
            }
            return Ok(remote);
        }
    }
    let tracks = state
        .db
        .get_liked_tracks_local()
        .map_err(|e| e.to_string())?;
    let count = tracks.len();
    Ok(PlaylistDetail {
        id: "LM".to_string(),
        title: "Liked Music".to_string(),
        subtitle: "Local & Synced Liked Songs".to_string(),
        description: None,
        thumbnail: tracks.first().map(|t| t.thumbnail.clone()).unwrap_or_default(),
        track_count: count,
        total_duration_text: None,
        is_album: false,
        is_local: true,
        tracks,
    })
}

#[tauri::command]
async fn ytm_rate_song(state: State<'_, AppState>, track: Track, rating: String) -> Result<(), String> {
    let mut updated = track.clone();
    updated.like_status = Some(rating.clone());
    let _ = state.db.upsert_track(&updated);
    let _ = state.db.set_track_like_status(&track.video_id, &rating);
    if state.auth.is_logged_in() {
        let _ = state.innertube.rate_song(&track.video_id, &rating).await;
    }
    Ok(())
}

#[tauri::command]
async fn ytm_subscribe_artist(
    state: State<'_, AppState>,
    channel_id: String,
    subscribe: bool,
) -> Result<(), String> {
    state
        .innertube
        .set_artist_subscription(&channel_id, subscribe)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ytm_create_playlist(
    state: State<'_, AppState>,
    title: String,
    description: String,
    synced: bool,
) -> Result<String, String> {
    if synced && state.auth.is_logged_in() {
        state
            .innertube
            .create_remote_playlist(&title, &description)
            .await
            .map_err(|e| e.to_string())
    } else {
        let id = format!("local_{}", uuid::Uuid::new_v4().simple());
        state
            .db
            .create_local_playlist(&id, &title, if description.is_empty() { None } else { Some(&description) })
            .map_err(|e| e.to_string())?;
        Ok(id)
    }
}

#[tauri::command]
async fn ytm_add_to_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    track: Track,
) -> Result<(), String> {
    if playlist_id.starts_with("local_") {
        state
            .db
            .add_track_to_local_playlist(&playlist_id, &track)
            .map_err(|e| e.to_string())
    } else {
        state
            .innertube
            .add_to_remote_playlist(&playlist_id, &track.video_id)
            .await
            .map_err(|e| e.to_string())
    }
}

// ============================================================================
// Local Library & History Commands
// ============================================================================

#[tauri::command]
async fn list_local_playlists(state: State<'_, AppState>) -> Result<Vec<LocalPlaylistSummary>, String> {
    state.db.list_local_playlists().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_local_playlist(state: State<'_, AppState>, playlist_id: String) -> Result<PlaylistDetail, String> {
    let (title, description, tracks) = state
        .db
        .get_local_playlist_tracks(&playlist_id)
        .map_err(|e| e.to_string())?;
    let count = tracks.len();
    Ok(PlaylistDetail {
        id: playlist_id,
        title,
        subtitle: "Local Playlist".to_string(),
        description,
        thumbnail: tracks.first().map(|t| t.thumbnail.clone()).unwrap_or_default(),
        track_count: count,
        total_duration_text: None,
        is_album: false,
        is_local: true,
        tracks,
    })
}

#[tauri::command]
async fn remove_from_local_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    video_id: String,
) -> Result<(), String> {
    state
        .db
        .remove_track_from_local_playlist(&playlist_id, &video_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_local_playlist(state: State<'_, AppState>, playlist_id: String) -> Result<(), String> {
    state
        .db
        .delete_local_playlist(&playlist_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder_playlist_tracks(
    state: State<'_, AppState>,
    playlist_id: String,
    video_ids: Vec<String>,
    moved_set_video_id: Option<String>,
    before_set_video_id: Option<String>,
) -> Result<(), String> {
    state
        .db
        .save_playlist_order(&playlist_id, &video_ids)
        .map_err(|e| e.to_string())?;

    if !playlist_id.starts_with("local_") && playlist_id != "LM" {
        if let Some(svid) = moved_set_video_id {
            let _ = state
                .innertube
                .move_remote_playlist_track(&playlist_id, &svid, before_set_video_id.as_deref())
                .await;
        }
    }
    Ok(())
}

#[tauri::command]
async fn reset_playlist_order(state: State<'_, AppState>, playlist_id: String) -> Result<(), String> {
    state
        .db
        .clear_playlist_order(&playlist_id)
        .map_err(|e| e.to_string())
}

fn apply_saved_playlist_order(db: &Database, playlist_id: &str, tracks: &mut Vec<Track>) {
    if let Ok(Some(order)) = db.get_playlist_order(playlist_id) {
        let mut pos_map = std::collections::HashMap::new();
        for (i, vid) in order.iter().enumerate() {
            pos_map.insert(vid.as_str(), i);
        }
        tracks.sort_by_key(|t| pos_map.get(t.video_id.as_str()).copied().unwrap_or(usize::MAX));
    }
}

#[tauri::command]
async fn get_downloaded_tracks(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    state.db.get_downloaded_tracks().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_recent_history(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<Track>, String> {
    state
        .db
        .get_recent_history(limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

// ============================================================================
// Pure-Rust Audiophile Playback Commands
// ============================================================================

#[tauri::command]
async fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    Ok(AudioEngine::list_output_devices())
}

#[tauri::command]
async fn play_track(app: AppHandle, state: State<'_, AppState>, mut track: Track) -> Result<PlaybackSnapshot, String> {
    state.audio.set_loading(true, Some(track.clone()));
    let _ = app.emit("playback-state", state.audio.snapshot());

    // Check if track has a downloaded local file
    let local_file = track
        .local_path
        .as_ref()
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| {
            state
                .db
                .get_track(&track.video_id)
                .ok()
                .flatten()
                .and_then(|t| t.local_path.map(PathBuf::from))
                .filter(|p| p.is_file())
        });

    let settings = state.settings.read().unwrap().clone();
    let ffmpeg_path = state.binaries.resolve_ffmpeg();

    let play_req = if let Some(path) = local_file {
        let ext = path.extension().and_then(|s| s.to_str()).map(|s| s.to_string());
        let codec_label = track
            .codec
            .clone()
            .or_else(|| ext.as_ref().map(|e| e.to_uppercase()))
            .unwrap_or_else(|| "LOCAL".to_string());
        PlayRequest {
            track: track.clone(),
            file_path: path,
            ext_hint: ext,
            codec_label,
            bitrate_kbps: track.bitrate_kbps.unwrap_or(256),
            format_id: Some("LOCAL".to_string()),
            is_local_file: true,
            progress: None,
            ffmpeg_path: ffmpeg_path.clone(),
        }
    } else if let Some(cached_path) = state.cache.cached_file_for(&track.video_id) {
        let ext = cached_path.extension().and_then(|s| s.to_str()).map(|s| s.to_string());
        let codec_label = match ext.as_deref() {
            Some("webm") | Some("opus") | Some("ogg") => "OPUS".to_string(),
            Some("m4a") => "AAC".to_string(),
            Some("flac") => "FLAC".to_string(),
            Some(other) => other.to_uppercase(),
            None => "AUDIO".to_string(),
        };
        PlayRequest {
            track: track.clone(),
            file_path: cached_path,
            ext_hint: ext,
            codec_label,
            bitrate_kbps: track.bitrate_kbps.unwrap_or(160),
            format_id: Some("CACHE".to_string()),
            is_local_file: true,
            progress: None,
            ffmpeg_path: ffmpeg_path.clone(),
        }
    } else {
        if settings.downloads.offline_mode {
            let msg = "Offline mode is enabled and this song is not downloaded or cached.".to_string();
            state.audio.set_error(msg.clone());
            return Err(msg);
        }

        // Resolve solved audio stream via yt-dlp + parallel 4-worker 512KB Range download to cache (~1s)
        let resolved = match state
            .ytdlp
            .resolve_audio_stream(&track.video_id, &settings.audio.streaming_quality)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = e.to_string();
                state.audio.set_error(msg.clone());
                let _ = app.emit("playback-state", state.audio.snapshot());
                return Err(msg);
            }
        };

        if track.loudness_db.is_none() {
            track.loudness_db = resolved.loudness_db;
        }
        if track.duration_secs == 0 && resolved.duration_secs > 0 {
            track.duration_secs = resolved.duration_secs;
        }
        track.codec = Some(resolved.codec.clone());
        track.bitrate_kbps = Some(resolved.bitrate_kbps);

        let full_cache = state
            .cache
            .download_full_ranged(
                &track.video_id,
                &resolved.ext,
                &resolved.url,
                &resolved.http_headers,
                state.auth.cookie_header(),
                settings.downloads.max_cache_mb,
            )
            .await;

        match full_cache {
            Ok(cached_file) => PlayRequest {
                track: track.clone(),
                file_path: cached_file,
                ext_hint: Some(resolved.ext),
                codec_label: resolved.codec,
                bitrate_kbps: resolved.bitrate_kbps,
                format_id: Some(resolved.format_id),
                is_local_file: true,
                progress: None,
                ffmpeg_path: ffmpeg_path.clone(),
            },
            Err(e) => {
                logger::warn(
                    "audio",
                    format!("Parallel Range cache failed ({e}); trying direct yt-dlp cache fallback"),
                );
                state.ytdlp.invalidate(&track.video_id);
                match state
                    .ytdlp
                    .download_to_cache(
                        &track.video_id,
                        &settings.audio.streaming_quality,
                        state.cache.cache_dir(),
                    )
                    .await
                {
                    Ok(cached_file) => {
                        let ext = cached_file
                            .extension()
                            .and_then(|s| s.to_str())
                            .map(|s| s.to_string());
                        PlayRequest {
                            track: track.clone(),
                            file_path: cached_file,
                            ext_hint: ext,
                            codec_label: resolved.codec,
                            bitrate_kbps: resolved.bitrate_kbps,
                            format_id: Some(resolved.format_id),
                            is_local_file: true,
                            progress: None,
                            ffmpeg_path: ffmpeg_path.clone(),
                        }
                    }
                    Err(fb_err) => {
                        let msg = format!("{e} | Fallback: {fb_err}");
                        logger::error("audio", format!("Playback failed for {}: {msg}", track.video_id));
                        state.audio.set_error(msg.clone());
                        let _ = app.emit("playback-state", state.audio.snapshot());
                        return Err(msg);
                    }
                }
            }
        }
    };

    let _ = state.db.record_play(&track);

    if let Err(e) = state.audio.play(play_req) {
        let msg = e.to_string();
        state.audio.set_error(msg.clone());
        return Err(msg);
    }

    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn preload_track(state: State<'_, AppState>, video_id: String) -> Result<(), String> {
    let settings = state.settings.read().unwrap().clone();
    if settings.downloads.offline_mode || state.cache.cached_file_for(&video_id).is_some() {
        return Ok(());
    }
    if let Ok(resolved) = state
        .ytdlp
        .resolve_audio_stream(&video_id, &settings.audio.streaming_quality)
        .await
    {
        let _ = state
            .cache
            .download_full_ranged(
                &video_id,
                &resolved.ext,
                &resolved.url,
                &resolved.http_headers,
                state.auth.cookie_header(),
                settings.downloads.max_cache_mb,
            )
            .await;
    }
    Ok(())
}

#[tauri::command]
async fn pause_playback(app: AppHandle, state: State<'_, AppState>) -> Result<PlaybackSnapshot, String> {
    state.audio.pause();
    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn resume_playback(app: AppHandle, state: State<'_, AppState>) -> Result<PlaybackSnapshot, String> {
    state.audio.resume();
    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn toggle_playback(app: AppHandle, state: State<'_, AppState>) -> Result<PlaybackSnapshot, String> {
    state.audio.toggle_play_pause();
    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn seek_playback(app: AppHandle, state: State<'_, AppState>, position_ms: u64) -> Result<PlaybackSnapshot, String> {
    state.audio.seek(position_ms);
    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn set_volume(app: AppHandle, state: State<'_, AppState>, volume: f32) -> Result<PlaybackSnapshot, String> {
    state.audio.set_volume(volume);
    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn set_muted(app: AppHandle, state: State<'_, AppState>, muted: bool) -> Result<PlaybackSnapshot, String> {
    state.audio.set_muted(muted);
    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn stop_playback(app: AppHandle, state: State<'_, AppState>) -> Result<PlaybackSnapshot, String> {
    state.audio.stop();
    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn get_playback_snapshot(state: State<'_, AppState>) -> Result<PlaybackSnapshot, String> {
    Ok(state.audio.snapshot())
}

// ============================================================================
// Download Manager Commands
// ============================================================================

#[tauri::command]
async fn enqueue_download(
    app: AppHandle,
    state: State<'_, AppState>,
    track: Track,
) -> Result<DownloadItem, String> {
    let settings = state.settings.read().unwrap().clone();
    state
        .downloads
        .enqueue(app, track, settings.downloads, settings.audio.streaming_quality)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn enqueue_batch_download(
    app: AppHandle,
    state: State<'_, AppState>,
    tracks: Vec<Track>,
) -> Result<Vec<DownloadItem>, String> {
    let settings = state.settings.read().unwrap().clone();
    let mut items = Vec::with_capacity(tracks.len());
    for t in tracks {
        if let Ok(item) = state.downloads.enqueue(
            app.clone(),
            t,
            settings.downloads.clone(),
            settings.audio.streaming_quality.clone(),
        ) {
            items.push(item);
        }
    }
    Ok(items)
}

#[tauri::command]
async fn list_downloads(state: State<'_, AppState>) -> Result<Vec<DownloadItem>, String> {
    state.db.list_downloads().map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_download(
    app: AppHandle,
    state: State<'_, AppState>,
    download_id: String,
) -> Result<(), String> {
    state
        .downloads
        .cancel(&app, &download_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_download(
    state: State<'_, AppState>,
    download_id: String,
    delete_file: bool,
) -> Result<(), String> {
    state
        .downloads
        .remove_download(&download_id, delete_file)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_smart_downloads(app: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let settings = state.settings.read().unwrap().clone();
    let mut queued = 0usize;
    let downloaded_ids: std::collections::HashSet<String> = state
        .db
        .get_downloaded_tracks()
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.video_id)
        .collect();

    for pl_id in &settings.downloads.smart_playlist_ids {
        let tracks = if pl_id == "LM" && state.auth.is_logged_in() {
            state
                .innertube
                .get_liked_songs()
                .await
                .map(|p| p.tracks)
                .unwrap_or_default()
        } else if pl_id.starts_with("local_") {
            state
                .db
                .get_local_playlist_tracks(pl_id)
                .map(|(_, _, t)| t)
                .unwrap_or_default()
        } else {
            state
                .innertube
                .get_playlist(pl_id)
                .await
                .map(|p| p.tracks)
                .unwrap_or_default()
        };

        for t in tracks {
            if !downloaded_ids.contains(&t.video_id) {
                if state
                    .downloads
                    .enqueue(
                        app.clone(),
                        t,
                        settings.downloads.clone(),
                        settings.audio.streaming_quality.clone(),
                    )
                    .is_ok()
                {
                    queued += 1;
                }
            }
        }
    }
    Ok(queued)
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("LiquidYTM");
            std::fs::create_dir_all(&app_data_dir)?;
            logger::init(&app_data_dir);

            let default_music_dir = dirs::audio_dir()
                .unwrap_or_else(|| app_data_dir.join("Music"))
                .join("LiquidYTM");
            let _ = std::fs::create_dir_all(&default_music_dir);

            let db = Arc::new(Database::open(&app_data_dir.join("liquidytm.db"))?);
            let initial_settings =
                db.load_settings(&default_music_dir.to_string_lossy())?;
            let binaries = Arc::new(BinaryManager::new(&app_data_dir)?);
            let auth = Arc::new(AuthManager::new(&app_data_dir)?);
            let innertube = Arc::new(InnerTubeClient::new(auth.clone())?);
            let ytdlp = Arc::new(YtDlpResolver::new(binaries.clone(), auth.clone()));
            let cache = Arc::new(AudioCache::new(&app_data_dir)?);
            let audio = Arc::new(AudioEngine::new(initial_settings.audio.clone()));
            let downloads = Arc::new(DownloadManager::new(
                db.clone(),
                binaries.clone(),
                auth.clone(),
            ));

            let app_handle = app.handle().clone();
            let app_handle_end = app_handle.clone();
            audio.set_on_track_ended(move || {
                let _ = app_handle_end.emit("track-ended", ());
            });

            // Use hardware-accelerated Mica on Windows (much lighter than software Acrylic!)
            if initial_settings.glass.liquid_glass_enabled {
                if let Some(window) = app.get_webview_window("main") {
                    #[cfg(target_os = "windows")]
                    {
                        let _ = window_vibrancy::apply_mica(&window, Some(true));
                    }
                    #[cfg(target_os = "macos")]
                    {
                        let _ = window_vibrancy::apply_vibrancy(
                            &window,
                            window_vibrancy::NSVisualEffectMaterial::HudWindow,
                            None,
                            None,
                        );
                    }
                }
            }

            // Spawn lightweight 250ms playback state broadcaster
            let audio_ticker = audio.clone();
            let handle_ticker = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(250));
                loop {
                    interval.tick().await;
                    let snap = audio_ticker.snapshot();
                    if snap.is_playing || snap.is_loading {
                        let _ = handle_ticker.emit("playback-state", &snap);
                    }
                }
            });

            app.manage(AppState {
                db,
                binaries,
                auth,
                innertube,
                ytdlp,
                cache,
                audio,
                downloads,
                settings: Arc::new(RwLock::new(initial_settings)),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_logs,
            clear_logs,
            log_frontend_event,
            export_logs,
            get_settings,
            save_settings,
            get_cache_stats,
            clear_audio_cache,
            get_binary_status,
            install_or_update_ytdlp,
            get_account_info,
            open_ytmusic_login,
            finish_ytmusic_login,
            import_cookies_text,
            logout_account,
            ytm_get_home,
            ytm_get_explore,
            ytm_search,
            ytm_search_suggestions,
            ytm_get_artist,
            ytm_get_playlist,
            ytm_get_watch_playlist,
            ytm_get_related,
            ytm_get_lyrics,
            ytm_get_library_playlists,
            ytm_get_liked_songs,
            ytm_rate_song,
            ytm_subscribe_artist,
            ytm_create_playlist,
            ytm_add_to_playlist,
            list_local_playlists,
            get_local_playlist,
            remove_from_local_playlist,
            delete_local_playlist,
            reorder_playlist_tracks,
            reset_playlist_order,
            get_downloaded_tracks,
            get_recent_history,
            list_audio_devices,
            play_track,
            preload_track,
            pause_playback,
            resume_playback,
            toggle_playback,
            seek_playback,
            set_volume,
            set_muted,
            stop_playback,
            get_playback_snapshot,
            enqueue_download,
            enqueue_batch_download,
            list_downloads,
            cancel_download,
            remove_download,
            sync_smart_downloads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LiquidYTM");
}
