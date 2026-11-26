use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::logger;
use crate::models::{AppUpdateInfo, PlaybackSnapshot, SponsorSegment, Track};

// ============================================================================
// 1. Windows System Media Transport Controls (SMTC) via `souvlaki`
// ============================================================================

pub struct SmtcController {
    controls: Mutex<Option<souvlaki::MediaControls>>,
    last_track_id: Mutex<Option<String>>,
    last_playing: Mutex<Option<bool>>,
    enabled: Mutex<bool>,
}

// souvlaki::MediaControls on Windows holds an STA COM wrapper; we strictly guard every
// access behind a Mutex so cross-thread calls are serialized.
unsafe impl Send for SmtcController {}
unsafe impl Sync for SmtcController {}

impl SmtcController {
    pub fn new_inactive(enabled: bool) -> Self {
        Self {
            controls: Mutex::new(None),
            last_track_id: Mutex::new(None),
            last_playing: Mutex::new(None),
            enabled: Mutex::new(enabled),
        }
    }

    pub fn attach<F>(&self, hwnd_raw: Option<*mut std::ffi::c_void>, on_event: F)
    where
        F: Fn(souvlaki::MediaControlEvent) + Send + 'static,
    {
        let config = souvlaki::PlatformConfig {
            dbus_name: "liquidytm",
            display_name: "LiquidYTM",
            hwnd: hwnd_raw,
        };
        match souvlaki::MediaControls::new(config) {
            Ok(mut ctrl) => {
                if let Err(e) = ctrl.attach(on_event) {
                    logger::warn("smtc", format!("Failed to attach media controls handler: {e:?}"));
                } else {
                    logger::info("smtc", "Windows Media Controls (SMTC) attached");
                }
                *self.controls.lock().unwrap() = Some(ctrl);
            }
            Err(e) => {
                logger::warn("smtc", format!("Could not initialize OS Media Controls: {e:?}"));
            }
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        *self.enabled.lock().unwrap() = enabled;
        if !enabled {
            if let Some(ctrl) = self.controls.lock().unwrap().as_mut() {
                let _ = ctrl.set_playback(souvlaki::MediaPlayback::Stopped);
            }
            *self.last_track_id.lock().unwrap() = None;
            *self.last_playing.lock().unwrap() = None;
        }
    }

    pub fn sync(&self, snap: &PlaybackSnapshot) {
        if !*self.enabled.lock().unwrap() {
            return;
        }
        let mut guard = self.controls.lock().unwrap();
        let Some(ctrl) = guard.as_mut() else {
            return;
        };

        let Some(track) = snap.current_track.as_ref() else {
            let mut lp = self.last_playing.lock().unwrap();
            if lp.is_some() {
                let _ = ctrl.set_playback(souvlaki::MediaPlayback::Stopped);
                *lp = None;
                *self.last_track_id.lock().unwrap() = None;
            }
            return;
        };

        let mut last_id = self.last_track_id.lock().unwrap();
        if last_id.as_deref() != Some(track.video_id.as_str()) {
            let duration = if snap.duration_ms > 0 {
                Some(Duration::from_millis(snap.duration_ms))
            } else if track.duration_secs > 0 {
                Some(Duration::from_secs(track.duration_secs))
            } else {
                None
            };
            let cover = if track.thumbnail.starts_with("http") {
                Some(track.thumbnail.as_str())
            } else {
                None
            };
            let _ = ctrl.set_metadata(souvlaki::MediaMetadata {
                title: Some(&track.title),
                artist: Some(&track.artist),
                album: track.album.as_deref(),
                duration,
                cover_url: cover,
            });
            *last_id = Some(track.video_id.clone());
        }
        drop(last_id);

        let mut lp = self.last_playing.lock().unwrap();
        let progress = Some(souvlaki::MediaPosition(Duration::from_millis(snap.position_ms)));
        let pb = if snap.is_playing {
            souvlaki::MediaPlayback::Playing { progress }
        } else {
            souvlaki::MediaPlayback::Paused { progress }
        };
        if *lp != Some(snap.is_playing) || snap.is_playing {
            let _ = ctrl.set_playback(pb);
            *lp = Some(snap.is_playing);
        }
    }
}

// ============================================================================
// 2. Native Zero-Dependency Discord Rich Presence (Named Pipe IPC)
// ============================================================================

const DISCORD_CLIENT_ID: &str = "1314262045569843230";

#[derive(Clone, PartialEq)]
struct DiscordActivityKey {
    video_id: String,
    is_playing: bool,
}

pub struct DiscordRpc {
    enabled: Arc<Mutex<bool>>,
    last_key: Arc<Mutex<Option<DiscordActivityKey>>>,
    #[cfg(target_os = "windows")]
    pipe: Arc<Mutex<Option<std::fs::File>>>,
}

impl DiscordRpc {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled: Arc::new(Mutex::new(enabled)),
            last_key: Arc::new(Mutex::new(None)),
            #[cfg(target_os = "windows")]
            pipe: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        *self.enabled.lock().unwrap() = enabled;
        if !enabled {
            *self.last_key.lock().unwrap() = None;
            #[cfg(target_os = "windows")]
            {
                let pipe_arc = self.pipe.clone();
                std::thread::spawn(move || {
                    let mut guard = pipe_arc.lock().unwrap();
                    if let Some(ref mut f) = *guard {
                        let _ = send_discord_clear(f);
                    }
                    *guard = None;
                });
            }
        }
    }

    pub fn sync(&self, snap: &PlaybackSnapshot) {
        if !*self.enabled.lock().unwrap() {
            return;
        }
        let key = snap.current_track.as_ref().map(|t| DiscordActivityKey {
            video_id: t.video_id.clone(),
            is_playing: snap.is_playing,
        });
        {
            let mut last = self.last_key.lock().unwrap();
            if *last == key {
                return;
            }
            *last = key;
        }

        #[cfg(target_os = "windows")]
        {
            let pipe_arc = self.pipe.clone();
            let track_opt = snap.current_track.clone();
            let is_playing = snap.is_playing;
            let pos_ms = snap.position_ms;
            let dur_ms = snap.duration_ms;

            std::thread::spawn(move || {
                let mut guard = pipe_arc.lock().unwrap();
                if guard.is_none() {
                    *guard = connect_discord_ipc();
                }
                let Some(ref mut file) = *guard else {
                    return;
                };
                let ok = match track_opt {
                    Some(track) if is_playing => {
                        send_discord_activity(file, &track, pos_ms, dur_ms).is_ok()
                    }
                    _ => send_discord_clear(file).is_ok(),
                };
                if !ok {
                    *guard = None;
                }
            });
        }
    }
}

#[cfg(target_os = "windows")]
fn connect_discord_ipc() -> Option<std::fs::File> {
    use std::fs::OpenOptions;
    for i in 0..10 {
        let path = format!(r"\\.\pipe\discord-ipc-{i}");
        if let Ok(mut file) = OpenOptions::new().read(true).write(true).open(&path) {
            let handshake = json!({
                "v": 1,
                "client_id": DISCORD_CLIENT_ID
            });
            if write_discord_frame(&mut file, 0, &handshake).is_ok() {
                let _ = read_discord_frame(&mut file);
                return Some(file);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn write_discord_frame(file: &mut std::fs::File, opcode: u32, payload: &Value) -> Result<()> {
    use std::io::Write;
    let body = serde_json::to_vec(payload)?;
    let mut frame = Vec::with_capacity(8 + body.len());
    frame.extend_from_slice(&opcode.to_le_bytes());
    frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
    frame.extend_from_slice(&body);
    file.write_all(&frame)?;
    file.flush()?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_discord_frame(file: &mut std::fs::File) -> Result<Value> {
    use std::io::Read;
    let mut header = [0u8; 8];
    file.read_exact(&mut header)?;
    let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    if len > 256 * 1024 {
        return Err(anyhow!("Discord IPC response too large"));
    }
    let mut body = vec![0u8; len];
    file.read_exact(&mut body)?;
    Ok(serde_json::from_slice(&body)?)
}

#[cfg(target_os = "windows")]
fn send_discord_activity(
    file: &mut std::fs::File,
    track: &Track,
    position_ms: u64,
    duration_ms: u64,
) -> Result<()> {
    let now_secs = chrono::Utc::now().timestamp();
    let start_secs = now_secs - (position_ms / 1000) as i64;
    let end_secs = if duration_ms > position_ms {
        Some(start_secs + (duration_ms / 1000) as i64)
    } else if track.duration_secs > 0 {
        Some(start_secs + track.duration_secs as i64)
    } else {
        None
    };

    let mut timestamps = json!({ "start": start_secs });
    if let Some(end) = end_secs {
        timestamps["end"] = json!(end);
    }

    let large_image = if track.thumbnail.starts_with("http") {
        track.thumbnail.clone()
    } else {
        "liquidytm".to_string()
    };

    let details = if track.title.len() < 2 {
        format!("{} ", track.title)
    } else {
        track.title.chars().take(120).collect()
    };
    let state_txt = if track.artist.len() < 2 {
        "Listening on LiquidYTM".to_string()
    } else {
        format!("by {}", track.artist.chars().take(110).collect::<String>())
    };

    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": {
                "type": 2,
                "details": details,
                "state": state_txt,
                "timestamps": timestamps,
                "assets": {
                    "large_image": large_image,
                    "large_text": track.album.as_deref().unwrap_or("LiquidYTM")
                }
            }
        },
        "nonce": uuid::Uuid::new_v4().to_string()
    });
    write_discord_frame(file, 1, &payload)?;
    let _ = read_discord_frame(file);
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_discord_clear(file: &mut std::fs::File) -> Result<()> {
    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": Value::Null
        },
        "nonce": uuid::Uuid::new_v4().to_string()
    });
    write_discord_frame(file, 1, &payload)?;
    let _ = read_discord_frame(file);
    Ok(())
}

// ============================================================================
// 3. SponsorBlock Client (Non-Music Intros / Outros Auto-Skip)
// ============================================================================

pub struct SponsorBlockClient {
    http: reqwest::Client,
    cache: RwLock<HashMap<String, Vec<SponsorSegment>>>,
}

impl SponsorBlockClient {
    pub fn new() -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent("LiquidYTM/0.1 (SponsorBlock)")
            .timeout(Duration::from_secs(4))
            .build()?;
        Ok(Self {
            http,
            cache: RwLock::new(HashMap::new()),
        })
    }

    pub async fn get_segments(&self, video_id: &str) -> Vec<SponsorSegment> {
        if video_id.starts_with("localfile_") || video_id.len() < 8 {
            return Vec::new();
        }
        if let Some(hit) = self.cache.read().unwrap().get(video_id) {
            return hit.clone();
        }
        let url = format!(
            "https://sponsor.ajay.app/api/skipSegments?videoID={video_id}&categories=[\"music_offtopic\",\"intro\",\"outro\"]"
        );
        let segments = match self.http.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(arr) = resp.json::<Vec<Value>>().await {
                    arr.into_iter()
                        .filter_map(|item| {
                            let seg = item.get("segment")?.as_array()?;
                            let start = seg.first()?.as_f64()?;
                            let end = seg.get(1)?.as_f64()?;
                            let category = item
                                .get("category")
                                .and_then(|v| v.as_str())
                                .unwrap_or("music_offtopic")
                                .to_string();
                            if end > start + 0.5 {
                                Some(SponsorSegment {
                                    start_secs: start,
                                    end_secs: end,
                                    category,
                                })
                            } else {
                                None
                            }
                        })
                        .collect()
                } else {
                    Vec::new()
                }
            }
            _ => Vec::new(),
        };
        self.cache
            .write()
            .unwrap()
            .insert(video_id.to_string(), segments.clone());
        segments
    }
}

// ============================================================================
// 4. GitHub Releases Update Checker
// ============================================================================

pub async fn check_github_update() -> Result<AppUpdateInfo> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let http = reqwest::Client::builder()
        .user_agent("LiquidYTM-Updater/0.1")
        .timeout(Duration::from_secs(10))
        .build()?;

    let resp = http
        .get("https://api.github.com/repos/anesbo/ytmusic-app/releases/latest")
        .send()
        .await?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(AppUpdateInfo {
            current_version: current_version.clone(),
            latest_version: current_version,
            update_available: false,
            release_url: "https://github.com/anesbo/ytmusic-app/releases".to_string(),
            release_notes: "No GitHub Releases published yet — you are running the latest local build.".to_string(),
        });
    }

    let json: Value = resp.error_for_status()?.json().await?;
    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or(&current_version)
        .trim_start_matches('v')
        .to_string();
    let html_url = json
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/anesbo/ytmusic-app/releases")
        .to_string();
    let body = json
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(500)
        .collect::<String>();

    let update_available = is_newer_semver(&tag, &current_version);
    Ok(AppUpdateInfo {
        current_version,
        latest_version: tag,
        update_available,
        release_url: html_url,
        release_notes: body,
    })
}

fn is_newer_semver(candidate: &str, current: &str) -> bool {
    let parse = |s: &str| -> (u32, u32, u32) {
        let mut parts = s.split('.');
        let a = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let b = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let c = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        (a, b, c)
    };
    parse(candidate) > parse(current)
}
