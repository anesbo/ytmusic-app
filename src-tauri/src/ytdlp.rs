use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::auth::AuthManager;
use crate::binaries::{hidden_command, BinaryManager};
use crate::logger;

#[derive(Debug, Clone)]
pub struct ResolvedAudioStream {
    pub url: String,
    pub ext: String,
    pub codec: String,
    pub bitrate_kbps: u32,
    pub format_id: String,
    pub duration_secs: u64,
    pub loudness_db: Option<f32>,
    pub http_headers: HashMap<String, String>,
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
                    // Prefer direct HTTPS non-HLS audio streams: Premium 256k Opus (774) / AAC (141) -> 251 Opus -> 140 AAC
                    "774[protocol^=http]/141[protocol^=http]/251[protocol^=http]/140[protocol^=http]/bestaudio[protocol^=http][ext=webm]/bestaudio[protocol^=http]/bestaudio/best"
                } else {
                    "251[protocol^=http]/140[protocol^=http]/bestaudio[protocol^=http][ext=webm]/bestaudio[protocol^=http]/bestaudio/best"
                }
            }
            "high" => "251[protocol^=http]/140[protocol^=http]/bestaudio[protocol^=http]/bestaudio/best",
            "normal" => "250[protocol^=http]/140[protocol^=http]/251[protocol^=http]/bestaudio[protocol^=http]/bestaudio/best",
            "saver" => "249[protocol^=http]/250[protocol^=http]/worstaudio[protocol^=http]/bestaudio",
            _ => "251[protocol^=http]/140[protocol^=http]/bestaudio[protocol^=http]/bestaudio/best",
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
        {
            let guard = self.cache.read().unwrap();
            if let Some(hit) = guard.get(video_id) {
                if hit.resolved_at.elapsed() < Duration::from_secs(7200) {
                    logger::info(
                        "ytdlp",
                        format!("Cache hit for {video_id} (fmt #{}, {} {}k)", hit.format_id, hit.codec, hit.bitrate_kbps),
                    );
                    return Ok(hit.clone());
                }
            }
        }

        let ytdlp = self.binaries.ensure_ytdlp().await?;
        let is_logged_in = self.auth.is_logged_in();
        let selector = Self::format_selector(quality, is_logged_in);
        let url = format!("https://music.youtube.com/watch?v={video_id}");

        let js_runtime = self.binaries.resolve_js_runtime();

        logger::info(
            "ytdlp",
            format!(
                "Resolving {video_id} using {} (logged_in={is_logged_in}, quality={quality}, js_runtime={js_runtime:?})",
                ytdlp.display()
            ),
        );

        let run_resolve = |use_cookies: bool| {
            let mut cmd = hidden_command(&ytdlp);
            cmd.args([
                "--dump-single-json",
                "--no-playlist",
                "--no-warnings",
                "--no-check-certificates",
                "-f",
                selector,
            ]);
            if let Some(ref rt) = js_runtime {
                cmd.args(["--js-runtimes", rt]);
            }
            if use_cookies {
                if let Some(cookie_file) = self.auth.ytdlp_cookies_file() {
                    cmd.arg("--cookies").arg(cookie_file);
                }
            }
            cmd.arg(&url)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            cmd
        };

        let mut output = run_resolve(true)
            .output()
            .await
            .context("Failed to execute yt-dlp to resolve audio stream")?;

        // If authenticated resolution failed, automatically retry without cookies as clean fallback
        if !output.status.success() && is_logged_in {
            let first_err = String::from_utf8_lossy(&output.stderr);
            logger::warn(
                "ytdlp",
                format!("Authenticated resolve failed for {video_id}, retrying without cookies: {}", first_err.trim()),
            );
            output = run_resolve(false)
                .output()
                .await
                .context("Failed to execute yt-dlp fallback resolve")?;
        }

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            logger::error("ytdlp", format!("yt-dlp failed for {video_id}: {}", err.trim()));
            return Err(anyhow!(
                "yt-dlp failed to resolve audio stream: {}",
                err.lines().last().unwrap_or(err.trim())
            ));
        }

        let json: Value = serde_json::from_slice(&output.stdout)
            .context("Failed to parse yt-dlp JSON output")?;

        let stream_url = json
            .get("url")
            .or_else(|| json.pointer("/requested_formats/0/url"))
            .or_else(|| json.pointer("/requested_downloads/0/url"))
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

        let mut http_headers = HashMap::new();
        if let Some(hdrs) = json.get("http_headers").and_then(|v| v.as_object()) {
            for (k, v) in hdrs {
                if let Some(s) = v.as_str() {
                    http_headers.insert(k.clone(), s.to_string());
                }
            }
        }

        logger::info(
            "ytdlp",
            format!(
                "Resolved {video_id} -> fmt #{format_id}, ext={ext}, codec={codec}, {bitrate_kbps}kbps, dur={duration_secs}s"
            ),
        );

        let resolved = ResolvedAudioStream {
            url: stream_url,
            ext,
            codec,
            bitrate_kbps,
            format_id,
            duration_secs,
            loudness_db: None,
            http_headers,
            resolved_at: Instant::now(),
        };

        self.cache
            .write()
            .unwrap()
            .insert(video_id.to_string(), resolved.clone());
        Ok(resolved)
    }

    /// Fallback: directly downloads audio into the cache directory via yt-dlp when direct HTTP
    /// streaming fails (e.g. HLS/DASH manifest or 403 client header mismatch).
    pub async fn download_to_cache(
        &self,
        video_id: &str,
        quality: &str,
        cache_dir: &Path,
    ) -> Result<PathBuf> {
        let ytdlp = self.binaries.ensure_ytdlp().await?;
        let ffmpeg = self.binaries.resolve_ffmpeg();
        let selector = Self::format_selector(quality, self.auth.is_logged_in());
        let url = format!("https://music.youtube.com/watch?v={video_id}");
        let out_tpl = cache_dir.join(format!("{video_id}.%(ext)s"));

        logger::warn(
            "ytdlp",
            format!("Using direct yt-dlp cache fallback for {video_id}"),
        );

        let mut cmd = hidden_command(&ytdlp);
        cmd.args([
            "--no-playlist",
            "--no-warnings",
            "--no-check-certificates",
            "--print",
            "after_move:CACHED|%(filepath)s",
            "-f",
            selector,
            "-o",
            &out_tpl.to_string_lossy(),
        ]);

        if let Some(rt) = self.binaries.resolve_js_runtime() {
            cmd.args(["--js-runtimes", &rt]);
        }
        if let Some(cookie_file) = self.auth.ytdlp_cookies_file() {
            cmd.arg("--cookies").arg(cookie_file);
        }
        if let Some(ff) = &ffmpeg {
            cmd.arg("--ffmpeg-location").arg(ff);
        }

        cmd.arg(&url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let output = cmd.output().await.context("Failed to spawn yt-dlp cache fallback")?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            logger::error("ytdlp", format!("Cache fallback failed for {video_id}: {}", err.trim()));
            return Err(anyhow!("yt-dlp fallback failed: {}", err.lines().last().unwrap_or(err.trim())));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some(path) = line.strip_prefix("CACHED|") {
                let p = PathBuf::from(path.trim());
                if p.is_file() {
                    logger::info("ytdlp", format!("Cached fallback file: {}", p.display()));
                    return Ok(p);
                }
            }
        }
        Err(anyhow!("yt-dlp fallback finished but output file was not found"))
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
        assert!(sel.starts_with("774"));
        let free = YtDlpResolver::format_selector("maximum", false);
        assert!(free.starts_with("251"));
    }
}
