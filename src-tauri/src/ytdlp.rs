use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::auth::AuthManager;
use crate::binaries::{hidden_command, BinaryManager};

#[derive(Debug, Clone)]
pub struct ResolvedAudioStream {
    pub url: String,
    pub ext: String,
    pub codec: String,
    pub bitrate_kbps: u32,
    pub format_id: String,
    pub duration_secs: u64,
    pub loudness_db: Option<f32>,
    pub resolved_at: Instant,
}

pub struct YtDlpResolver {
    binaries: Arc<BinaryManager>,
    auth: Arc<AuthManager>,
    cache: RwLock<HashMap<String, ResolvedAudioStream>>,
}

impl YtDlpResolver {
    pub fn new(binaries: Arc<BinaryManager>, auth: Arc<AuthManager>) -> Self {
        Self {
            binaries,
            auth,
            cache: RwLock::new(HashMap::new()),
        }
    }

    pub fn format_selector(quality: &str, is_logged_in: bool) -> &'static str {
        match quality {
            "maximum" => {
                if is_logged_in {
                    // Prioritize YT Music Premium 256kbps Opus (774) & AAC (141), then 251 Opus / 140 AAC
                    "774/141/251/140/bestaudio[acodec=opus]/bestaudio/best"
                } else {
                    "251/140/bestaudio[acodec=opus]/bestaudio/best"
                }
            }
            "high" => "251/140/bestaudio[acodec=opus]/bestaudio/best",
            "normal" => "250/140/251/bestaudio/best",
            "saver" => "249/250/worstaudio/bestaudio",
            _ => "251/140/bestaudio/best",
        }
    }

    pub fn invalidate(&self, video_id: &str) {
        self.cache.write().unwrap().remove(video_id);
    }

    pub async fn resolve_audio_stream(
        &self,
        video_id: &str,
        quality: &str,
    ) -> Result<ResolvedAudioStream> {
        // Reuse cached URL if under 2 hours old
        {
            let guard = self.cache.read().unwrap();
            if let Some(hit) = guard.get(video_id) {
                if hit.resolved_at.elapsed() < Duration::from_secs(7200) {
                    return Ok(hit.clone());
                }
            }
        }

        let ytdlp = self.binaries.ensure_ytdlp().await?;
        let is_logged_in = self.auth.is_logged_in();
        let selector = Self::format_selector(quality, is_logged_in);
        let url = format!("https://music.youtube.com/watch?v={video_id}");

        let mut cmd = hidden_command(&ytdlp);
        cmd.args([
            "--dump-single-json",
            "--no-playlist",
            "--no-warnings",
            "-f",
            selector,
        ]);

        if let Some(cookie_file) = self.auth.ytdlp_cookies_file() {
            cmd.arg("--cookies").arg(cookie_file);
        }

        cmd.arg(&url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let output = cmd
            .output()
            .await
            .context("Failed to execute yt-dlp to resolve audio stream")?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "yt-dlp failed to resolve audio stream: {}",
                err.lines().last().unwrap_or(err.trim())
            ));
        }

        let json: Value = serde_json::from_slice(&output.stdout)
            .context("Failed to parse yt-dlp JSON output")?;

        let stream_url = json
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("yt-dlp did not return a direct audio stream URL"))?
            .to_string();

        let ext = json
            .get("ext")
            .and_then(|v| v.as_str())
            .unwrap_or("webm")
            .to_string();

        let acodec_raw = json
            .get("acodec")
            .and_then(|v| v.as_str())
            .unwrap_or("opus");
        let codec = normalize_codec_label(acodec_raw);

        let bitrate_kbps = json
            .get("abr")
            .or_else(|| json.get("tbr"))
            .and_then(|v| v.as_f64())
            .map(|v| v.round() as u32)
            .unwrap_or(160);

        let format_id = json
            .get("format_id")
            .and_then(|v| v.as_str())
            .unwrap_or("bestaudio")
            .to_string();

        let duration_secs = json
            .get("duration")
            .and_then(|v| v.as_f64())
            .map(|v| v.round() as u64)
            .unwrap_or(0);

        let resolved = ResolvedAudioStream {
            url: stream_url,
            ext,
            codec,
            bitrate_kbps,
            format_id,
            duration_secs,
            loudness_db: None,
            resolved_at: Instant::now(),
        };

        self.cache
            .write()
            .unwrap()
            .insert(video_id.to_string(), resolved.clone());
        Ok(resolved)
    }
}

fn normalize_codec_label(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("opus") {
        "OPUS".to_string()
    } else if lower.contains("mp4a") || lower.contains("aac") {
        "AAC".to_string()
    } else if lower.contains("flac") {
        "FLAC".to_string()
    } else if lower.contains("mp3") {
        "MP3".to_string()
    } else if lower.contains("vorbis") {
        "VORBIS".to_string()
    } else {
        raw.to_uppercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_selector_prefers_premium_when_logged_in() {
        let sel = YtDlpResolver::format_selector("maximum", true);
        assert!(sel.starts_with("774/141/"));
        let free = YtDlpResolver::format_selector("maximum", false);
        assert!(free.starts_with("251/140/"));
    }
}
