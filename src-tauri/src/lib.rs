pub mod audio;
pub mod auth;
pub mod binaries;
pub mod db;
pub mod downloads;
pub mod innertube;
pub mod integrations;
pub mod local_library;
pub mod logger;
pub mod models;
pub mod scrobbler;
pub mod ytdlp;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::audio::source::AudioCache;
use crate::audio::{AudioEngine, PlayRequest};
use crate::auth::{AuthManager, StoredCookie};
use crate::binaries::BinaryManager;
use crate::db::Database;
use crate::downloads::DownloadManager;
use crate::innertube::InnerTubeClient;
use crate::integrations::{DiscordRpc, SmtcController, SponsorBlockClient};
use crate::models::{
    AccountInfo, AppSettings, AppUpdateInfo, ArtistDetail, AudioDeviceInfo, BinaryStatus,
    CacheStats, DownloadItem, ExploreResponse, HomeResponse, ListeningStats, LocalPlaylistSummary,
    LyricsData, PlaybackSnapshot, PlaylistDetail, SavedSessionState, SearchResponse, Shelf,
    ShelfItem, SponsorSegment, Track, TrackBookmark, WatchPlaylistResponse,
};
use crate::scrobbler::ScrobblerAndTranslate;
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
    pub smtc: Arc<SmtcController>,
    pub discord: Arc<DiscordRpc>,
    pub sponsorblock: Arc<SponsorBlockClient>,
    pub scrobbler: Arc<ScrobblerAndTranslate>,
    pub settings: Arc<RwLock<AppSettings>>,
    pub play_generation: Arc<AtomicU64>,
    pub active_play_cancel: Arc<Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
    pub active_preload_cancel: Arc<Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
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
    state.smtc.set_enabled(settings.media_keys_enabled);
    state.discord.set_enabled(settings.discord_rpc_enabled);
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
async fn play_track(
    app: AppHandle,
    state: State<'_, AppState>,
    mut track: Track,
    start_ms: Option<u64>,
    crossfade: Option<bool>,
) -> Result<PlaybackSnapshot, String> {
    let initial_seek_ms = start_ms.unwrap_or(0);
    let use_crossfade = crossfade.unwrap_or(false) && initial_seek_ms == 0;
    // 1. Immediately supersede and cancel any previous in-flight play_track AND any background preload!
    let my_gen = state.play_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut guard = state.active_play_cancel.lock().unwrap();
        if let Some(prev_tx) = guard.replace(cancel_tx) {
            let _ = prev_tx.send(true);
        }
    }
    {
        let mut pguard = state.active_preload_cancel.lock().unwrap();
        if let Some(prev_tx) = pguard.take() {
            let _ = prev_tx.send(true);
        }
    }

    // Stop the previous song immediately off the async executor (preserving crossfade tail if requested)
    let audio_stop = state.audio.clone();
    let _ = tokio::task::spawn_blocking(move || {
        if use_crossfade {
            audio_stop.stop_for_crossfade();
        } else {
            audio_stop.stop();
        }
    })
    .await;
    if state.play_generation.load(Ordering::SeqCst) != my_gen {
        return Ok(state.audio.snapshot());
    }
    state.audio.set_loading(true, Some(track.clone()));
    let _ = app.emit("playback-state", state.audio.snapshot());

    let is_superseded = || state.play_generation.load(Ordering::SeqCst) != my_gen;

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
            initial_seek_ms,
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
            initial_seek_ms,
        }
    } else {
        if settings.downloads.offline_mode {
            let msg = "Offline mode is enabled and this song is not downloaded or cached.".to_string();
            state.audio.set_error(msg.clone());
            return Err(msg);
        }

        // Resolve via cancellable yt-dlp (kills subprocess immediately if user switches songs!)
        let resolved = match state
            .ytdlp
            .resolve_audio_stream_cancellable(
                &track.video_id,
                &settings.audio.streaming_quality,
                &mut cancel_rx,
            )
            .await
        {
            Ok(r) => r,
            Err(e) => {
                if is_superseded() {
                    return Ok(state.audio.snapshot());
                }
                let msg = e.to_string();
                state.audio.set_error(msg.clone());
                let _ = app.emit("playback-state", state.audio.snapshot());
                return Err(msg);
            }
        };

        if is_superseded() {
            return Ok(state.audio.snapshot());
        }

        if track.loudness_db.is_none() {
            track.loudness_db = resolved.loudness_db;
        }
        if track.duration_secs == 0 && resolved.duration_secs > 0 {
            track.duration_secs = resolved.duration_secs;
        }
        track.codec = Some(resolved.codec.clone());
        track.bitrate_kbps = Some(resolved.bitrate_kbps);

        let full_cache = tokio::select! {
            res = state.cache.download_full_ranged(
                &track.video_id,
                &resolved.ext,
                &resolved.url,
                &resolved.http_headers,
                state.auth.cookie_header(),
                settings.downloads.max_cache_mb,
            ) => Some(res),
            _ = async {
                while !*cancel_rx.borrow() {
                    if cancel_rx.changed().await.is_err() {
                        std::future::pending::<()>().await;
                    }
                }
            } => None,
        };

        let Some(full_cache) = full_cache else {
            return Ok(state.audio.snapshot());
        };
        if is_superseded() {
            return Ok(state.audio.snapshot());
        }

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
                initial_seek_ms,
            },
            Err(e) => {
                if is_superseded() {
                    return Ok(state.audio.snapshot());
                }
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
                            initial_seek_ms,
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

    // Final generation check before opening hardware playback
    if is_superseded() {
        return Ok(state.audio.snapshot());
    }

    let _ = state.db.record_play(&track);

    if let Err(e) = state.audio.play(play_req) {
        let msg = e.to_string();
        state.audio.set_error(msg.clone());
        return Err(msg);
    }

    // Async Now Playing submission to Last.fm / ListenBrainz (if enabled)
    let scrobbler = state.scrobbler.clone();
    let settings_now = state.settings.read().unwrap().clone();
    let track_now = track.clone();
    tauri::async_runtime::spawn(async move {
        scrobbler.submit_now_playing(&settings_now, &track_now).await;
    });

    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn preload_track(state: State<'_, AppState>, video_id: String) -> Result<(), String> {
    let settings = state.settings.read().unwrap().clone();
    if settings.downloads.offline_mode
        || state.audio.is_loading_now()
        || state.cache.cached_file_for(&video_id).is_some()
    {
        return Ok(());
    }

    let start_gen = state.play_generation.load(Ordering::SeqCst);
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut pguard = state.active_preload_cancel.lock().unwrap();
        if let Some(prev_tx) = pguard.replace(cancel_tx) {
            let _ = prev_tx.send(true);
        }
    }

    let resolved = match state
        .ytdlp
        .resolve_audio_stream_cancellable(
            &video_id,
            &settings.audio.streaming_quality,
            &mut cancel_rx,
        )
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };

    if state.play_generation.load(Ordering::SeqCst) != start_gen || *cancel_rx.borrow() {
        return Ok(());
    }

    tokio::select! {
        _ = state.cache.download_full_ranged(
            &video_id,
            &resolved.ext,
            &resolved.url,
            &resolved.http_headers,
            state.auth.cookie_header(),
            settings.downloads.max_cache_mb,
        ) => {}
        _ = async {
            while !*cancel_rx.borrow() {
                if cancel_rx.changed().await.is_err() {
                    std::future::pending::<()>().await;
                }
            }
        } => {}
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
    // Also cancel any in-flight track resolution/preload immediately when stopping or switching tracks!
    state.play_generation.fetch_add(1, Ordering::SeqCst);
    {
        let mut guard = state.active_play_cancel.lock().unwrap();
        if let Some(prev_tx) = guard.take() {
            let _ = prev_tx.send(true);
        }
    }
    {
        let mut pguard = state.active_preload_cancel.lock().unwrap();
        if let Some(prev_tx) = pguard.take() {
            let _ = prev_tx.send(true);
        }
    }
    let audio_stop = state.audio.clone();
    let _ = tokio::task::spawn_blocking(move || audio_stop.stop()).await;
    let snap = state.audio.snapshot();
    let _ = app.emit("playback-state", &snap);
    Ok(snap)
}

#[tauri::command]
async fn get_playback_snapshot(state: State<'_, AppState>) -> Result<PlaybackSnapshot, String> {
    Ok(state.audio.snapshot())
}

#[tauri::command]
async fn set_playback_speed(
    state: State<'_, AppState>,
    speed: f32,
    preserve_pitch: bool,
) -> Result<(), String> {
    state.audio.set_playback_speed(speed, preserve_pitch);
    let mut s = state.settings.write().unwrap();
    s.audio.playback_speed = speed.clamp(0.5, 2.0);
    s.audio.preserve_pitch = preserve_pitch;
    let _ = state.db.save_settings(&s);
    Ok(())
}

#[tauri::command]
async fn preload_queue_urls(
    state: State<'_, AppState>,
    video_ids: Vec<String>,
) -> Result<(), String> {
    let settings = state.settings.read().unwrap().clone();
    if settings.downloads.offline_mode || state.audio.is_loading_now() {
        return Ok(());
    }
    let filtered: Vec<String> = video_ids
        .into_iter()
        .filter(|vid| !vid.starts_with("localfile_") && state.cache.cached_file_for(vid).is_none())
        .take(4)
        .collect();
    if filtered.is_empty() {
        return Ok(());
    }
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut pguard = state.active_preload_cancel.lock().unwrap();
        if let Some(prev_tx) = pguard.replace(cancel_tx) {
            let _ = prev_tx.send(true);
        }
    }
    let _ = state
        .ytdlp
        .resolve_batch_cancellable(&filtered, &settings.audio.streaming_quality, &mut cancel_rx)
        .await;
    Ok(())
}

// ============================================================================
// Scrobbling, Translation, Bookmarks, Local Tag Editor & File Reveal
// ============================================================================

#[tauri::command]
async fn scrobble_track(state: State<'_, AppState>, track: Track) -> Result<(), String> {
    let settings = state.settings.read().unwrap().clone();
    state.scrobbler.submit_scrobble(&settings, &track).await;
    Ok(())
}

#[tauri::command]
async fn translate_lyrics(
    state: State<'_, AppState>,
    cache_key: String,
    lines: Vec<String>,
    target_lang: String,
) -> Result<Vec<String>, String> {
    state
        .scrobbler
        .translate_lines(&cache_key, &lines, &target_lang)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_bookmarks(state: State<'_, AppState>, video_id: String) -> Result<Vec<TrackBookmark>, String> {
    state.db.list_bookmarks(&video_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_bookmark(
    state: State<'_, AppState>,
    video_id: String,
    time_ms: u64,
    label: String,
) -> Result<TrackBookmark, String> {
    state
        .db
        .add_bookmark(&video_id, time_ms, &label)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_bookmark(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.delete_bookmark(id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_local_track_tags(
    state: State<'_, AppState>,
    video_id: String,
    title: String,
    artist: String,
    album: Option<String>,
) -> Result<(), String> {
    if let Ok(Some(saved)) = state.db.get_track(&video_id) {
        if let Some(path_str) = saved.local_path {
            let p = PathBuf::from(&path_str);
            if p.is_file() {
                let t = title.clone();
                let a = artist.clone();
                let al = album.clone();
                tokio::task::spawn_blocking(move || {
                    local_library::write_local_track_tags(&p, &t, &a, al.as_deref())
                })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            }
        }
    }
    state
        .db
        .update_track_tags(&video_id, &title, &artist, album.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reveal_track_file(path: String) -> Result<(), String> {
    local_library::reveal_in_file_manager(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn merge_tracks_into_local_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    tracks: Vec<Track>,
) -> Result<usize, String> {
    let mut added = 0usize;
    for t in &tracks {
        if state.db.add_track_to_local_playlist(&playlist_id, t).is_ok() {
            added += 1;
        }
    }
    Ok(added)
}

// ============================================================================
// Listening Stats, Smart Auto-Playlists, Local Folders, Session & Export/Import
// ============================================================================

#[tauri::command]
async fn get_listening_stats(state: State<'_, AppState>) -> Result<ListeningStats, String> {
    state.db.get_listening_stats().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_smart_playlist(state: State<'_, AppState>, kind: String) -> Result<PlaylistDetail, String> {
    let tracks = state
        .db
        .get_smart_playlist_tracks(&kind)
        .map_err(|e| e.to_string())?;
    let (title, subtitle, desc) = match kind.as_str() {
        "most_played" => (
            "Most Played",
            "Smart Auto-Playlist",
            "Your most replayed tracks ranked by listening history.",
        ),
        "recently_downloaded" => (
            "Recently Downloaded",
            "Smart Auto-Playlist",
            "Tracks saved locally for instant offline playback.",
        ),
        "forgotten_favorites" => (
            "Forgotten Favorites",
            "Smart Auto-Playlist",
            "Liked and favorite songs you haven't played recently.",
        ),
        _ => ("Smart Playlist", "Smart Auto-Playlist", ""),
    };
    let count = tracks.len();
    Ok(PlaylistDetail {
        id: format!("smart_{kind}"),
        title: title.to_string(),
        subtitle: subtitle.to_string(),
        description: Some(desc.to_string()),
        thumbnail: tracks.first().map(|t| t.thumbnail.clone()).unwrap_or_default(),
        track_count: count,
        total_duration_text: None,
        is_album: false,
        is_local: true,
        tracks,
    })
}

#[tauri::command]
async fn get_local_library_tracks(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    state.db.get_local_library_tracks().map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_local_music_folders(
    state: State<'_, AppState>,
    folders: Vec<String>,
) -> Result<usize, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || local_library::scan_local_folders(&db, &folders))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_session_state(
    state: State<'_, AppState>,
    session: SavedSessionState,
) -> Result<(), String> {
    let json = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    state
        .db
        .save_kv("last_session", &json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_session_state(
    state: State<'_, AppState>,
) -> Result<Option<SavedSessionState>, String> {
    let raw = state.db.load_kv("last_session").map_err(|e| e.to_string())?;
    Ok(raw.and_then(|s| serde_json::from_str::<SavedSessionState>(&s).ok()))
}

#[tauri::command]
async fn export_playlist(
    detail: PlaylistDetail,
    format: String,
    path: Option<String>,
) -> Result<String, String> {
    let ext = if format.eq_ignore_ascii_case("json") {
        "json"
    } else {
        "m3u8"
    };
    let out_path = match path.filter(|s| !s.trim().is_empty()) {
        Some(p) => PathBuf::from(p),
        None => {
            let safe_name: String = detail
                .title
                .chars()
                .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { '_' })
                .collect();
            let dir = dirs::download_dir()
                .or_else(dirs::desktop_dir)
                .unwrap_or_else(|| PathBuf::from("."));
            dir.join(format!("{}.{ext}", safe_name.trim()))
        }
    };
    local_library::export_playlist_to_file(&detail, &format, &out_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_playlist_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<(String, usize), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || local_library::import_playlist_from_file(&db, std::path::Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_playlist_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<(String, usize), String> {
    let pl_id = local_library::extract_youtube_playlist_id(&url)
        .ok_or_else(|| "Could not find a valid YouTube / YouTube Music playlist ID in that URL.".to_string())?;
    let detail = state
        .innertube
        .get_playlist(&pl_id)
        .await
        .map_err(|e| e.to_string())?;
    if detail.tracks.is_empty() {
        return Err("That playlist contains no playable tracks.".to_string());
    }
    let local_id = format!("local_{}", uuid::Uuid::new_v4().simple());
    state
        .db
        .create_local_playlist(&local_id, &detail.title, detail.description.as_deref())
        .map_err(|e| e.to_string())?;
    for track in &detail.tracks {
        let _ = state.db.add_track_to_local_playlist(&local_id, track);
    }
    Ok((local_id, detail.tracks.len()))
}

// ============================================================================
// Integrations: SponsorBlock, Floating Lyrics Overlay & App Updates
// ============================================================================

#[tauri::command]
async fn get_sponsorblock_segments(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<Vec<SponsorSegment>, String> {
    Ok(state.sponsorblock.get_segments(&video_id).await)
}

#[tauri::command]
async fn open_lyrics_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("lyrics-overlay") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        "lyrics-overlay",
        WebviewUrl::App("index.html?mode=lyrics".into()),
    )
    .title("LiquidYTM Lyrics")
    .inner_size(580.0, 132.0)
    .min_inner_size(340.0, 96.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_lyrics_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("lyrics-overlay") {
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
async fn set_lyrics_clickthrough(app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("lyrics-overlay") {
        win.set_ignore_cursor_events(enabled)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn emit_lyrics_sync(app: AppHandle, payload: serde_json::Value) -> Result<(), String> {
    let _ = app.emit("lyrics-sync", payload);
    Ok(())
}

#[tauri::command]
async fn check_app_update() -> Result<AppUpdateInfo, String> {
    integrations::check_github_update()
        .await
        .map_err(|e| e.to_string())
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
    let sc_toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    let sc_next = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::ArrowRight);
    let sc_prev = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::ArrowLeft);
    let sc_like = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyL);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let enabled = app
                        .try_state::<AppState>()
                        .map(|s| s.settings.read().unwrap().global_hotkeys_enabled)
                        .unwrap_or(true);
                    if !enabled {
                        return;
                    }
                    if shortcut == &sc_toggle {
                        if let Some(st) = app.try_state::<AppState>() {
                            st.audio.toggle_play_pause();
                            let _ = app.emit("playback-state", st.audio.snapshot());
                        }
                    } else if shortcut == &sc_next {
                        let _ = app.emit("media-control", "next");
                    } else if shortcut == &sc_prev {
                        let _ = app.emit("media-control", "previous");
                    } else if shortcut == &sc_like {
                        let _ = app.emit("media-control", "like");
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let minimize = window
                        .app_handle()
                        .try_state::<AppState>()
                        .map(|s| s.settings.read().unwrap().minimize_to_tray)
                        .unwrap_or(false);
                    if minimize {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .setup(move |app| {
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
            let smtc = Arc::new(SmtcController::new_inactive(
                initial_settings.media_keys_enabled,
            ));
            let discord = Arc::new(DiscordRpc::new(initial_settings.discord_rpc_enabled));
            let sponsorblock = Arc::new(SponsorBlockClient::new()?);
            let scrobbler = Arc::new(ScrobblerAndTranslate::new()?);

            let app_handle = app.handle().clone();
            let app_handle_end = app_handle.clone();
            audio.set_on_track_ended(move || {
                let _ = app_handle_end.emit("track-ended", ());
            });

            // Register Global Hotkeys (ignore conflicts silently if another app owns a key)
            for sc in [sc_toggle, sc_next, sc_prev, sc_like] {
                let _ = app.global_shortcut().register(sc);
            }

            // Build Native System Tray with Playback Controls & Show/Quit
            if let (Ok(mi_show), Ok(mi_toggle), Ok(mi_next), Ok(mi_prev), Ok(mi_quit)) = (
                MenuItem::with_id(app, "tray_show", "Show LiquidYTM", true, None::<&str>),
                MenuItem::with_id(app, "tray_toggle", "Play / Pause", true, None::<&str>),
                MenuItem::with_id(app, "tray_next", "Next Track", true, None::<&str>),
                MenuItem::with_id(app, "tray_prev", "Previous Track", true, None::<&str>),
                MenuItem::with_id(app, "tray_quit", "Quit LiquidYTM", true, None::<&str>),
            ) {
                if let Ok(menu) =
                    Menu::with_items(app, &[&mi_show, &mi_toggle, &mi_next, &mi_prev, &mi_quit])
                {
                    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                        .menu(&menu)
                        .tooltip("LiquidYTM")
                        .show_menu_on_left_click(false)
                        .on_menu_event(|app, event| match event.id.as_ref() {
                            "tray_show" => {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.unminimize();
                                    let _ = w.set_focus();
                                }
                            }
                            "tray_toggle" => {
                                if let Some(st) = app.try_state::<AppState>() {
                                    st.audio.toggle_play_pause();
                                    let _ = app.emit("playback-state", st.audio.snapshot());
                                }
                            }
                            "tray_next" => {
                                let _ = app.emit("media-control", "next");
                            }
                            "tray_prev" => {
                                let _ = app.emit("media-control", "previous");
                            }
                            "tray_quit" => {
                                if let Some(st) = app.try_state::<AppState>() {
                                    st.audio.stop();
                                }
                                app.exit(0);
                            }
                            _ => {}
                        })
                        .on_tray_icon_event(|tray, event| {
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } = event
                            {
                                let app = tray.app_handle();
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.unminimize();
                                    let _ = w.set_focus();
                                }
                            }
                        });
                    if let Some(icon) = app.default_window_icon() {
                        tray_builder = tray_builder.icon(icon.clone());
                    }
                    let _ = tray_builder.build(app);
                }
            }

            // Attach Windows SMTC / OS Hardware Media Controls to main window HWND
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                let hwnd_raw = window.hwnd().ok().map(|h| h.0 as *mut std::ffi::c_void);
                #[cfg(not(target_os = "windows"))]
                let hwnd_raw = None;

                let audio_smtc = audio.clone();
                let app_smtc = app_handle.clone();
                smtc.attach(hwnd_raw, move |ev| match ev {
                    souvlaki::MediaControlEvent::Play => {
                        audio_smtc.resume();
                        let _ = app_smtc.emit("playback-state", audio_smtc.snapshot());
                    }
                    souvlaki::MediaControlEvent::Pause => {
                        audio_smtc.pause();
                        let _ = app_smtc.emit("playback-state", audio_smtc.snapshot());
                    }
                    souvlaki::MediaControlEvent::Toggle => {
                        audio_smtc.toggle_play_pause();
                        let _ = app_smtc.emit("playback-state", audio_smtc.snapshot());
                    }
                    souvlaki::MediaControlEvent::Next => {
                        let _ = app_smtc.emit("media-control", "next");
                    }
                    souvlaki::MediaControlEvent::Previous => {
                        let _ = app_smtc.emit("media-control", "previous");
                    }
                    souvlaki::MediaControlEvent::Stop => {
                        audio_smtc.stop();
                        let _ = app_smtc.emit("playback-state", audio_smtc.snapshot());
                    }
                    souvlaki::MediaControlEvent::SetPosition(pos) => {
                        audio_smtc.seek(pos.0.as_millis() as u64);
                        let _ = app_smtc.emit("playback-state", audio_smtc.snapshot());
                    }
                    _ => {}
                });

                // Use hardware-accelerated Mica on Windows (much lighter than software Acrylic!)
                if initial_settings.glass.liquid_glass_enabled {
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

            // Spawn lightweight 250ms playback state broadcaster + SMTC/Discord sync
            let audio_ticker = audio.clone();
            let smtc_ticker = smtc.clone();
            let discord_ticker = discord.clone();
            let handle_ticker = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(250));
                let mut was_playing = false;
                loop {
                    interval.tick().await;
                    let snap = audio_ticker.snapshot();
                    if snap.is_playing || snap.is_loading || was_playing {
                        let _ = handle_ticker.emit("playback-state", &snap);
                        smtc_ticker.sync(&snap);
                        discord_ticker.sync(&snap);
                    }
                    was_playing = snap.is_playing;
                }
            });

            // Spawn ~25 FPS spectrum emitter ONLY when visualizer_enabled && playing (0 overhead when OFF!)
            let audio_viz = audio.clone();
            let handle_viz = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(40));
                loop {
                    interval.tick().await;
                    if audio_viz.visualizer_enabled() && audio_viz.snapshot().is_playing {
                        let bars = audio_viz.spectrum_bars();
                        let _ = handle_viz.emit("audio-spectrum", bars);
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
                smtc,
                discord,
                sponsorblock,
                scrobbler,
                settings: Arc::new(RwLock::new(initial_settings)),
                play_generation: Arc::new(AtomicU64::new(0)),
                active_play_cancel: Arc::new(Mutex::new(None)),
                active_preload_cancel: Arc::new(Mutex::new(None)),
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
            preload_queue_urls,
            set_playback_speed,
            pause_playback,
            resume_playback,
            toggle_playback,
            seek_playback,
            set_volume,
            set_muted,
            stop_playback,
            get_playback_snapshot,
            get_listening_stats,
            get_smart_playlist,
            get_local_library_tracks,
            scan_local_music_folders,
            save_session_state,
            load_session_state,
            export_playlist,
            import_playlist_file,
            import_playlist_url,
            get_sponsorblock_segments,
            open_lyrics_overlay,
            close_lyrics_overlay,
            set_lyrics_clickthrough,
            emit_lyrics_sync,
            check_app_update,
            scrobble_track,
            translate_lyrics,
            list_bookmarks,
            add_bookmark,
            delete_bookmark,
            update_local_track_tags,
            reveal_track_file,
            merge_tracks_into_local_playlist,
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
