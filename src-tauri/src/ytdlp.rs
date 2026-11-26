use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tokio::sync::watch;

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
    /// Guarantees at most ONE yt-dlp subprocess tree runs across the entire app at any moment.
    resolve_gate: Arc<tokio::sync::Semaphore>,
}

impl YtDlpResolver {
    pub fn new(binaries: Arc<BinaryManager>, auth: Arc<AuthManager>) -> Self {
        Self {
            binaries,
            auth,
            cache: RwLock::new(HashMap::new()),
            resolve_gate: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }

    pub fn format_selector(quality: &str, is_logged_in: bool) -> &'static str {
        match quality {
            "maximum" => {
                if is_logged_in {
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
        let (_tx, mut rx) = watch::channel(false);
        self.resolve_audio_stream_cancellable(video_id, quality, &mut rx)
            .await
    }

    /// Resolves audio stream via yt-dlp and immediately kills the yt-dlp subprocess if
    /// `cancel_rx` signals `true` (e.g., user skipped to another song).
    pub async fn resolve_audio_stream_cancellable(
        &self,
        video_id: &str,
        quality: &str,
        cancel_rx: &mut watch::Receiver<bool>,
    ) -> Result<ResolvedAudioStream> {
        if *cancel_rx.borrow() {
            return Err(anyhow!("Cancelled"));
        }
        {
            let guard = self.cache.read().unwrap();
            if let Some(hit) = guard.get(video_id) {
                if hit.resolved_at.elapsed() < Duration::from_secs(7200) {
                    logger::info(
                        "ytdlp",
                        format!(
                            "Cache hit for {video_id} (fmt #{}, {} {}k)",
                            hit.format_id, hit.codec, hit.bitrate_kbps
                        ),
                    );
                    return Ok(hit.clone());
                }
            }
        }

        // Acquire single-slot yt-dlp gate (cancellable while waiting so rapid skipping never queues up!)
        let _permit = tokio::select! {
            p = self.resolve_gate.clone().acquire_owned() => {
                p.map_err(|_| anyhow!("Resolver gate closed"))?
            }
            _ = wait_for_cancel(cancel_rx) => {
                return Err(anyhow!("Cancelled"));
            }
        };

        if *cancel_rx.borrow() {
            return Err(anyhow!("Cancelled"));
        }

        // Re-check cache after acquiring gate in case a just-finished call populated it
        {
            let guard = self.cache.read().unwrap();
            if let Some(hit) = guard.get(video_id) {
                if hit.resolved_at.elapsed() < Duration::from_secs(7200) {
                    return Ok(hit.clone());
                }
            }
        }

        let ytdlp = self.binaries.ensure_ytdlp().await?;
        let cache_dir = self.binaries.ytdlp_cache_dir();
        let is_logged_in = self.auth.is_logged_in();
        let selector = Self::format_selector(quality, is_logged_in);
        let url = format!("https://music.youtube.com/watch?v={video_id}");
        let js_runtime = self.binaries.resolve_js_runtime();
        let t0 = Instant::now();

        logger::info(
            "ytdlp",
            format!(
                "Resolving {video_id} via yt-dlp (logged_in={is_logged_in}, quality={quality})"
            ),
        );

        let spawn_ytdlp = |use_cookies: bool| -> Result<tokio::process::Child> {
            let mut cmd = hidden_command(&ytdlp);
            cmd.args([
                "--dump-single-json",
                "--no-playlist",
                "--no-warnings",
                "--no-check-certificates",
                "--cache-dir",
            ]);
            cmd.arg(&cache_dir);
            cmd.args([
                "--extractor-args",
                "youtube:skip=hls,translated_subs",
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
            cmd.spawn()
                .context("Failed to spawn yt-dlp to resolve audio stream")
        };

        let mut output = run_child_cancellable(spawn_ytdlp(true)?, cancel_rx).await?;

        if !output.status.success() && is_logged_in {
            if *cancel_rx.borrow() {
                return Err(anyhow!("Cancelled"));
            }
            let first_err = String::from_utf8_lossy(&output.stderr);
            logger::warn(
                "ytdlp",
                format!(
                    "Authenticated resolve failed for {video_id}, retrying without cookies: {}",
                    first_err.trim()
                ),
            );
            output = run_child_cancellable(spawn_ytdlp(false)?, cancel_rx).await?;
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
                "Resolved {video_id} in {}ms -> fmt #{format_id}, ext={ext}, codec={codec}, {bitrate_kbps}kbps",
                t0.elapsed().as_millis()
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

    /// Warm batch URL pre-resolver: resolves up to 4 upcoming tracks in ONE single `yt-dlp`
    /// process invocation (paying the 1.4s Python startup cost once and reusing player JS),
    /// streaming each JSON line directly into `self.cache` as soon as it finishes!
    pub async fn resolve_batch_cancellable(
        &self,
        video_ids: &[String],
        quality: &str,
        cancel_rx: &mut watch::Receiver<bool>,
    ) -> usize {
        let to_resolve: Vec<String> = {
            let guard = self.cache.read().unwrap();
            video_ids
                .iter()
                .filter(|id| {
                    !id.starts_with("localfile_")
                        && !guard
                            .get(*id)
                            .map(|h| h.resolved_at.elapsed() < Duration::from_secs(7200))
                            .unwrap_or(false)
                })
                .take(4)
                .cloned()
                .collect()
        };
        if to_resolve.is_empty() || *cancel_rx.borrow() {
            return 0;
        }

        let _permit = tokio::select! {
            p = self.resolve_gate.clone().acquire_owned() => match p {
                Ok(p) => p,
                Err(_) => return 0,
            },
            _ = wait_for_cancel(cancel_rx) => return 0,
        };
        if *cancel_rx.borrow() {
            return 0;
        }

        let Ok(ytdlp) = self.binaries.ensure_ytdlp().await else {
            return 0;
        };
        let cache_dir = self.binaries.ytdlp_cache_dir();
        let is_logged_in = self.auth.is_logged_in();
        let selector = Self::format_selector(quality, is_logged_in);
        let js_runtime = self.binaries.resolve_js_runtime();

        let mut cmd = hidden_command(&ytdlp);
        cmd.args([
            "--dump-json",
            "--no-playlist",
            "--ignore-errors",
            "--no-warnings",
            "--no-check-certificates",
            "--cache-dir",
        ]);
        cmd.arg(&cache_dir);
        cmd.args([
            "--extractor-args",
            "youtube:skip=hls,translated_subs",
            "-f",
            selector,
        ]);
        if let Some(ref rt) = js_runtime {
            cmd.args(["--js-runtimes", rt]);
        }
        if let Some(cookie_file) = self.auth.ytdlp_cookies_file() {
            cmd.arg("--cookies").arg(cookie_file);
        }
        for vid in &to_resolve {
            cmd.arg(format!("https://music.youtube.com/watch?v={vid}"));
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::null());

        let Ok(mut child) = cmd.spawn() else {
            return 0;
        };
        let pid = child.id();
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill().await;
            return 0;
        };

        let mut lines = tokio::io::AsyncBufReadExt::lines(tokio::io::BufReader::new(stdout));
        let mut count = 0usize;
        loop {
            tokio::select! {
                line_res = lines.next_line() => {
                    match line_res {
                        Ok(Some(line)) => {
                            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                                if let Some((vid, resolved)) = parse_resolved_json(&json) {
                                    self.cache.write().unwrap().insert(vid.clone(), resolved);
                                    count += 1;
                                    logger::info("ytdlp", format!("Warm batch cached stream URL for {vid}"));
                                }
                            }
                        }
                        _ => break,
                    }
                }
                _ = wait_for_cancel(cancel_rx) => {
                    if let Some(pid) = pid {
                        let _ = tokio::task::spawn_blocking(move || {
                            crate::binaries::kill_process_tree(pid);
                        }).await;
                    }
                    let _ = child.kill().await;
                    let _ = tokio::time::timeout(Duration::from_millis(300), child.wait()).await;
                    return count;
                }
            }
        }
        let _ = child.wait().await;
        count
    }

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
            return Err(anyhow!(
                "yt-dlp fallback failed: {}",
                err.lines().last().unwrap_or(err.trim())
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some(path) = line.strip_prefix("CACHED|") {
                let p = PathBuf::from(path.trim());
                if p.is_file() {
                    return Ok(p);
                }
            }
        }
        Err(anyhow!("yt-dlp fallback finished but output file was not found"))
    }
}

async fn wait_for_cancel(cancel_rx: &mut watch::Receiver<bool>) {
    while !*cancel_rx.borrow() {
        if cancel_rx.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

async fn run_child_cancellable(
    mut child: tokio::process::Child,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<std::process::Output> {
    let pid = child.id();
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let out_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(mut s) = stdout.take() {
            let _ = tokio::io::AsyncReadExt::read_to_end(&mut s, &mut buf).await;
        }
        buf
    });
    let err_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(mut s) = stderr.take() {
            let _ = tokio::io::AsyncReadExt::read_to_end(&mut s, &mut buf).await;
        }
        buf
    });

    tokio::select! {
        status = child.wait() => {
            let status = status?;
            let out_bytes = out_task.await.unwrap_or_default();
            let err_bytes = err_task.await.unwrap_or_default();
            Ok(std::process::Output {
                status,
                stdout: out_bytes,
                stderr: err_bytes,
            })
        }
        _ = wait_for_cancel(cancel_rx) => {
            // Kill the ENTIRE process tree (yt-dlp + child Python + node.exe) so zero zombies survive!
            if let Some(pid) = pid {
                let _ = tokio::task::spawn_blocking(move || {
                    crate::binaries::kill_process_tree(pid);
                }).await;
            }
            let _ = child.kill().await;
            out_task.abort();
            err_task.abort();
            let _ = tokio::time::timeout(Duration::from_millis(400), child.wait()).await;
            Err(anyhow!("Cancelled"))
        }
    }
}

fn parse_resolved_json(json: &Value) -> Option<(String, ResolvedAudioStream)> {
    let vid = json.get("id")?.as_str()?.to_string();
    let stream_url = json
        .get("url")
        .or_else(|| json.pointer("/requested_formats/0/url"))
        .or_else(|| json.pointer("/requested_downloads/0/url"))
        .and_then(|v| v.as_str())?
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
    Some((
        vid,
        ResolvedAudioStream {
            url: stream_url,
            ext,
            codec,
            bitrate_kbps,
            format_id,
            duration_secs,
            loudness_db: None,
            http_headers,
            resolved_at: Instant::now(),
        },
    ))
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
