use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderName, HeaderValue};
use symphonia::core::io::MediaSource;

use crate::logger;
use crate::models::CacheStats;

/// Shared state between the background HTTP downloader and the Symphonia progressive reader.
pub struct DownloadProgress {
    pub bytes_written: AtomicU64,
    pub total_bytes: AtomicU64, // 0 if unknown
    pub finished: AtomicBool,
    pub failed: AtomicBool,
    pub cancelled: AtomicBool,
}

impl DownloadProgress {
    pub fn new(total_bytes: u64) -> Self {
        Self {
            bytes_written: AtomicU64::new(0),
            total_bytes: AtomicU64::new(total_bytes),
            finished: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
        }
    }

    pub fn buffered_ratio(&self) -> f32 {
        let total = self.total_bytes.load(Ordering::Relaxed);
        let written = self.bytes_written.load(Ordering::Relaxed);
        if self.finished.load(Ordering::Relaxed) {
            return 1.0;
        }
        if total == 0 {
            return if written > 0 { 0.25 } else { 0.0 };
        }
        (written as f32 / total as f32).clamp(0.0, 1.0)
    }
}

/// A seekable Symphonia `MediaSource` backed by a progressively downloading cache file.
pub struct ProgressiveMediaSource {
    file: File,
    pos: u64,
    progress: Arc<DownloadProgress>,
}

impl ProgressiveMediaSource {
    pub fn open(path: &Path, progress: Arc<DownloadProgress>) -> io::Result<Self> {
        let file = File::open(path)?;
        Ok(Self {
            file,
            pos: 0,
            progress,
        })
    }

    fn wait_for_bytes(&self, target_pos: u64) -> io::Result<u64> {
        loop {
            if self.progress.cancelled.load(Ordering::Acquire) {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "Stream cancelled"));
            }
            let written = self.progress.bytes_written.load(Ordering::Acquire);
            if written > target_pos {
                return Ok(written);
            }
            if self.progress.finished.load(Ordering::Acquire) {
                return Ok(written);
            }
            if self.progress.failed.load(Ordering::Acquire) {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "Upstream audio stream download failed",
                ));
            }
            std::thread::sleep(Duration::from_millis(8));
        }
    }
}

impl Read for ProgressiveMediaSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let available = self.wait_for_bytes(self.pos)?;
        if available <= self.pos {
            return Ok(0);
        }
        let max_to_read = ((available - self.pos) as usize).min(buf.len());
        self.file.seek(SeekFrom::Start(self.pos))?;
        let n = self.file.read(&mut buf[..max_to_read])?;
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for ProgressiveMediaSource {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let total = self.progress.total_bytes.load(Ordering::Acquire);
        let written = self.progress.bytes_written.load(Ordering::Acquire);
        let known_len = if total > 0 { total } else { written };

        let new_pos: i64 = match pos {
            SeekFrom::Start(o) => o as i64,
            SeekFrom::Current(o) => self.pos as i64 + o,
            SeekFrom::End(o) => known_len as i64 + o,
        };
        if new_pos < 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Negative seek position",
            ));
        }
        let target = new_pos as u64;
        let _ = self.wait_for_bytes(target);
        self.pos = target;
        self.file.seek(SeekFrom::Start(self.pos))
    }
}

impl MediaSource for ProgressiveMediaSource {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        let total = self.progress.total_bytes.load(Ordering::Acquire);
        if total > 0 {
            Some(total)
        } else if self.progress.finished.load(Ordering::Acquire) {
            Some(self.progress.bytes_written.load(Ordering::Acquire))
        } else {
            None
        }
    }
}

pub struct AudioCache {
    cache_dir: PathBuf,
    http: reqwest::Client,
}

impl AudioCache {
    pub fn new(app_data_dir: &Path) -> Result<Self> {
        let cache_dir = app_data_dir.join("audio_cache");
        std::fs::create_dir_all(&cache_dir)?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self { cache_dir, http })
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn cached_file_for(&self, video_id: &str) -> Option<PathBuf> {
        for ext in ["webm", "opus", "m4a", "mp4", "ogg", "mp3", "flac"] {
            let p = self.cache_dir.join(format!("{video_id}.{ext}"));
            if p.is_file() && std::fs::metadata(&p).map(|m| m.len() > 8192).unwrap_or(false) {
                return Some(p);
            }
        }
        None
    }

    /// Starts streaming a remote URL into a progressive cache file and returns
    /// `(file_path, progress)` once the initial header buffer (~128KB or EOF) has arrived.
    pub async fn start_progressive_stream(
        &self,
        video_id: &str,
        ext: &str,
        url: &str,
        http_headers: &HashMap<String, String>,
        cookie_header: Option<String>,
        max_cache_mb: u64,
    ) -> Result<(PathBuf, Arc<DownloadProgress>)> {
        let safe_ext = if ext.is_empty() { "webm" } else { ext };
        let final_path = self.cache_dir.join(format!("{video_id}.{safe_ext}"));
        let part_path = self.cache_dir.join(format!("{video_id}.{safe_ext}.part"));

        let mut req = self.http.get(url);
        let mut has_ua = false;
        for (k, v) in http_headers {
            if k.eq_ignore_ascii_case("user-agent") {
                has_ua = true;
            }
            if let (Ok(hn), Ok(hv)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                req = req.header(hn, hv);
            }
        }
        if !has_ua {
            req = req.header(
                reqwest::header::USER_AGENT,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            );
        }
        if let Some(cookie) = cookie_header {
            req = req.header(reqwest::header::COOKIE, cookie);
        }

        logger::info("audio", format!("Fetching remote stream for {video_id} ({safe_ext})"));
        let mut resp = req
            .send()
            .await
            .context("Failed to connect to audio stream URL")?;

        if !resp.status().is_success() {
            let st = resp.status();
            logger::error("audio", format!("Audio stream HTTP error {st} for {video_id}"));
            return Err(anyhow!("Audio stream HTTP error: {st}"));
        }

        let total_bytes = resp.content_length().unwrap_or(0);
        let progress = Arc::new(DownloadProgress::new(total_bytes));

        let mut writer = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .context("Failed to create progressive audio cache file")?;

        // Read initial ~128KB synchronously so Symphonia can probe container headers immediately.
        // For M4A/MP4 containers, if small (<6MB), read slightly more or let background finish quickly.
        let mut written: u64 = 0;
        let initial_target: u64 = 128 * 1024;
        let mut eof = false;

        while written < initial_target {
            match resp.chunk().await? {
                Some(chunk) => {
                    writer.write_all(&chunk)?;
                    written += chunk.len() as u64;
                    progress.bytes_written.store(written, Ordering::Release);
                }
                None => {
                    eof = true;
                    break;
                }
            }
        }
        writer.flush()?;

        logger::info(
            "audio",
            format!("Initial buffer ready for {video_id}: {written} / {total_bytes} bytes (eof={eof})"),
        );

        if eof {
            progress.total_bytes.store(written, Ordering::Release);
            progress.finished.store(true, Ordering::Release);
            drop(writer);
            let _ = std::fs::copy(&part_path, &final_path);
            let _ = self.enforce_limit(max_cache_mb);
            return Ok((final_path, progress));
        }

        let progress_bg = progress.clone();
        let part_bg = part_path.clone();
        let final_bg = final_path.clone();
        let cache_dir = self.cache_dir.clone();
        let vid_log = video_id.to_string();

        tokio::spawn(async move {
            let mut total_written = written;
            let mut ok = true;
            while !progress_bg.cancelled.load(Ordering::Acquire) {
                match resp.chunk().await {
                    Ok(Some(chunk)) => {
                        if writer.write_all(&chunk).is_err() {
                            ok = false;
                            break;
                        }
                        total_written += chunk.len() as u64;
                        progress_bg
                            .bytes_written
                            .store(total_written, Ordering::Release);
                    }
                    Ok(None) => break,
                    Err(e) => {
                        logger::warn("audio", format!("Stream chunk read error for {vid_log}: {e}"));
                        ok = false;
                        break;
                    }
                }
            }
            let _ = writer.flush();
            drop(writer);

            if ok && !progress_bg.cancelled.load(Ordering::Acquire) {
                progress_bg
                    .total_bytes
                    .store(total_written, Ordering::Release);
                progress_bg.finished.store(true, Ordering::Release);
                let _ = std::fs::copy(&part_bg, &final_bg);
                let _ = enforce_limit_in_dir(&cache_dir, max_cache_mb);
            } else {
                progress_bg.failed.store(true, Ordering::Release);
            }
        });

        Ok((part_path, progress))
    }

    pub fn stats(&self, max_cache_mb: u64) -> CacheStats {
        let mut used = 0u64;
        let mut count = 0usize;
        if let Ok(entries) = std::fs::read_dir(&self.cache_dir) {
            for e in entries.flatten() {
                if let Ok(meta) = e.metadata() {
                    if meta.is_file() {
                        used += meta.len();
                        count += 1;
                    }
                }
            }
        }
        CacheStats {
            used_bytes: used,
            file_count: count,
            max_bytes: max_cache_mb * 1024 * 1024,
        }
    }

    pub fn clear(&self) -> Result<()> {
        if let Ok(entries) = std::fs::read_dir(&self.cache_dir) {
            for e in entries.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
        Ok(())
    }

    pub fn enforce_limit(&self, max_cache_mb: u64) -> Result<()> {
        enforce_limit_in_dir(&self.cache_dir, max_cache_mb)
    }
}

fn enforce_limit_in_dir(dir: &Path, max_cache_mb: u64) -> Result<()> {
    let max_bytes = max_cache_mb * 1024 * 1024;
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total = 0u64;
    for entry in std::fs::read_dir(dir)?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) == Some("part") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                let len = meta.len();
                let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                total += len;
                files.push((p, len, mtime));
            }
        }
    }
    if total <= max_bytes {
        return Ok(());
    }
    files.sort_by_key(|f| f.2);
    for (p, len, _) in files {
        if total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&p).is_ok() {
            total = total.saturating_sub(len);
        }
    }
    Ok(())
}
