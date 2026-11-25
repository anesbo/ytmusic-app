use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};

use crate::auth::AuthManager;
use crate::binaries::{hidden_command, BinaryManager};
use crate::logger;

const IOS_UA: &str =
    "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

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
    http: reqwest::Client,
    cache: RwLock<HashMap<String, ResolvedAudioStream>>,
}

impl YtDlpResolver {
    pub fn new(binaries: Arc<BinaryManager>, auth: Arc<AuthManager>) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(12))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            binaries,
            auth,
            http,
            cache: RwLock::new(HashMap::new()),
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

    /// Ultra-fast (~250ms) direct InnerTube IOS `/player` audio stream resolver.
    /// Avoids spawning Python/yt-dlp + Node.js on every track click!
    async fn resolve_fast_innertube(
        &self,
        video_id: &str,
        quality: &str,
    ) -> Result<ResolvedAudioStream> {
        let t0 = Instant::now();
        let body = json!({
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true,
            "context": {
                "client": {
                    "clientName": "IOS",
                    "clientVersion": "20.10.4",
                    "deviceMake": "Apple",
                    "deviceModel": "iPhone16,2",
                    "osName": "iPhone",
                    "osVersion": "18.3.2.22D82",
                    "hl": "en",
                    "gl": "US",
                    "userAgent": IOS_UA
                }
            }
        });

        let resp = self
            .http
            .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .header(reqwest::header::USER_AGENT, IOS_UA)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        let data: Value = resp.json().await?;
        let status = data
            .pointer("/playabilityStatus/status")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if status != "OK" {
            return Err(anyhow!("Fast InnerTube status: {status}"));
        }

        let loudness_db = data
            .pointer("/playerConfig/audioConfig/loudnessDb")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32);

        let formats = data
            .pointer("/streamingData/adaptiveFormats")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow!("No adaptiveFormats"))?;

        let audio_formats: Vec<&Value> = formats
            .iter()
            .filter(|f| {
                f.get("url").and_then(|u| u.as_str()).is_some()
                    && f.get("mimeType")
                        .and_then(|m| m.as_str())
                        .map(|m| m.starts_with("audio/"))
                        .unwrap_or(false)
            })
            .collect();

        if audio_formats.is_empty() {
            return Err(anyhow!("No direct audio URLs in IOS player response"));
        }

        let preferred_itags: &[i64] = match quality {
            "maximum" => &[774, 141, 251, 140, 250, 249, 139],
            "high" => &[251, 140, 250, 249, 139],
            "normal" => &[250, 140, 251, 249],
            "saver" => &[249, 139, 250],
            _ => &[251, 140, 250, 249],
        };

        let chosen = preferred_itags
            .iter()
            .find_map(|&itag| {
                audio_formats
                    .iter()
                    .find(|f| f.get("itag").and_then(|v| v.as_i64()) == Some(itag))
                    .copied()
            })
            .or_else(|| {
                audio_formats
                    .iter()
                    .max_by_key(|f| f.get("bitrate").and_then(|b| b.as_u64()).unwrap_or(0))
                    .copied()
            })
            .ok_or_else(|| anyhow!("No audio format selected"))?;

        let stream_url = chosen
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("Missing format url"))?
            .to_string();

        let itag = chosen.get("itag").and_then(|v| v.as_i64()).unwrap_or(0);
        let mime = chosen
            .get("mimeType")
            .and_then(|v| v.as_str())
            .unwrap_or("audio/webm; codecs=\"opus\"");
        let (ext, codec) = if mime.contains("webm") || mime.contains("opus") {
            ("webm".to_string(), "OPUS".to_string())
        } else if mime.contains("mp4") || mime.contains("mp4a") {
            ("m4a".to_string(), "AAC".to_string())
        } else {
            ("webm".to_string(), "AUDIO".to_string())
        };

        let bitrate_kbps = chosen
            .get("averageBitrate")
            .or_else(|| chosen.get("bitrate"))
            .and_then(|v| v.as_u64())
            .map(|b| (b / 1000) as u32)
            .unwrap_or(160);

        let duration_secs = chosen
            .get("approxDurationMs")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|ms| ms / 1000)
            .or_else(|| {
                data.pointer("/videoDetails/lengthSeconds")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<u64>().ok())
            })
            .unwrap_or(0);

        let mut http_headers = HashMap::new();
        http_headers.insert("User-Agent".to_string(), IOS_UA.to_string());

        logger::info(
            "ytdlp",
            format!(
                "Fast-resolved {video_id} in {}ms -> fmt #{itag}, {codec} {bitrate_kbps}kbps, loudness={loudness_db:?}",
                t0.elapsed().as_millis()
            ),
        );

        Ok(ResolvedAudioStream {
            url: stream_url,
            ext,
            codec,
            bitrate_kbps,
            format_id: itag.to_string(),
            duration_secs,
            loudness_db,
            http_headers,
            resolved_at: Instant::now(),
        })
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

        // 1. Try ultra-fast (~250ms) direct InnerTube IOS resolver first!
        match self.resolve_fast_innertube(video_id, quality).await {
            Ok(resolved) => {
                self.cache
                    .write()
                    .unwrap()
                    .insert(video_id.to_string(), resolved.clone());
                return Ok(resolved);
            }
            Err(fast_err) => {
                logger::info(
                    "ytdlp",
                    format!("Fast resolver fallback to yt-dlp for {video_id}: {fast_err}"),
                );
            }
        }

        // 2. Rock-solid yt-dlp fallback (for age-restricted / private / special tracks)
        let ytdlp = self.binaries.ensure_ytdlp().await?;
        let is_logged_in = self.auth.is_logged_in();
        let selector = Self::format_selector(quality, is_logged_in);
        let url = format!("https://music.youtube.com/watch?v={video_id}");
        let js_runtime = self.binaries.resolve_js_runtime();

        logger::info(
            "ytdlp",
            format!(
                "Resolving {video_id} via yt-dlp (logged_in={is_logged_in}, quality={quality})"
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
                "Resolved {video_id} -> fmt #{format_id}, ext={ext}, codec={codec}, {bitrate_kbps}kbps"
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
            return Err(anyhow!("yt-dlp fallback failed: {}", err.lines().last().unwrap_or(err.trim())));
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
