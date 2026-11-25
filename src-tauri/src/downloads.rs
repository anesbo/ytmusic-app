use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use lofty::config::WriteOptions;
use lofty::file::AudioFile;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::{Accessor, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Tag;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Semaphore;

use crate::auth::AuthManager;
use crate::binaries::{hidden_command, BinaryManager};
use crate::db::Database;
use crate::models::{DownloadItem, DownloadSettings, Track};
use crate::ytdlp::YtDlpResolver;

pub struct DownloadManager {
    db: Arc<Database>,
    binaries: Arc<BinaryManager>,
    auth: Arc<AuthManager>,
    semaphore: Arc<Semaphore>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    http: reqwest::Client,
}

impl DownloadManager {
    pub fn new(db: Arc<Database>, binaries: Arc<BinaryManager>, auth: Arc<AuthManager>) -> Self {
        Self {
            db,
            binaries,
            auth,
            semaphore: Arc::new(Semaphore::new(3)),
            cancel_flags: Arc::new(Mutex::new(HashMap::new())),
            http: reqwest::Client::new(),
        }
    }

    pub fn enqueue(
        self: &Arc<Self>,
        app: AppHandle,
        track: Track,
        settings: DownloadSettings,
        streaming_quality: String,
    ) -> Result<DownloadItem> {
        let _ = self.db.upsert_track(&track);

        let id = format!("dl_{}", uuid::Uuid::new_v4().simple());
        let item = DownloadItem {
            id: id.clone(),
            video_id: track.video_id.clone(),
            title: track.title.clone(),
            artist: track.artist.clone(),
            album: track.album.clone(),
            thumbnail: track.thumbnail.clone(),
            duration_secs: track.duration_secs,
            status: "queued".to_string(),
            progress: 0.0,
            speed: String::new(),
            eta: String::new(),
            format: settings.format.clone(),
            file_path: None,
            error: None,
            created_at: chrono::Utc::now().timestamp(),
        };

        self.db.upsert_download(&item)?;
        let _ = app.emit("download-updated", &item);

        let cancel_flag = Arc::new(AtomicBool::new(false));
        self.cancel_flags
            .lock()
            .unwrap()
            .insert(id.clone(), cancel_flag.clone());

        let mgr = Arc::clone(self);
        let item_bg = item.clone();
        tokio::spawn(async move {
            mgr.run_download_job(app, item_bg, track, settings, streaming_quality, cancel_flag)
                .await;
        });

        Ok(item)
    }

    pub fn cancel(&self, app: &AppHandle, download_id: &str) -> Result<()> {
        if let Some(flag) = self.cancel_flags.lock().unwrap().get(download_id) {
            flag.store(true, Ordering::SeqCst);
        }
        if let Ok(items) = self.db.list_downloads() {
            if let Some(mut item) = items.into_iter().find(|i| i.id == download_id) {
                item.status = "cancelled".to_string();
                let _ = self.db.upsert_download(&item);
                let _ = app.emit("download-updated", &item);
            }
        }
        Ok(())
    }

    pub fn remove_download(&self, download_id: &str, delete_file: bool) -> Result<()> {
        if let Some(flag) = self.cancel_flags.lock().unwrap().remove(download_id) {
            flag.store(true, Ordering::SeqCst);
        }
        if let Some(item) = self.db.delete_download(download_id)? {
            if delete_file {
                if let Some(path) = &item.file_path {
                    let _ = std::fs::remove_file(path);
                }
                let _ = self.db.clear_track_download(&item.video_id);
            }
        }
        Ok(())
    }

    async fn run_download_job(
        self: Arc<Self>,
        app: AppHandle,
        mut item: DownloadItem,
        track: Track,
        settings: DownloadSettings,
        streaming_quality: String,
        cancel_flag: Arc<AtomicBool>,
    ) {
        let _permit = match self.semaphore.acquire().await {
            Ok(p) => p,
            Err(_) => return,
        };

        if cancel_flag.load(Ordering::Acquire) {
            return;
        }

        item.status = "downloading".to_string();
        let _ = self.db.upsert_download(&item);
        let _ = app.emit("download-updated", &item);

        let result = self
            .execute_ytdlp_download(
                &app,
                &mut item,
                &track,
                &settings,
                &streaming_quality,
                &cancel_flag,
            )
            .await;

        self.cancel_flags.lock().unwrap().remove(&item.id);

        if cancel_flag.load(Ordering::Acquire) {
            item.status = "cancelled".to_string();
            let _ = self.db.upsert_download(&item);
            let _ = app.emit("download-updated", &item);
            return;
        }

        match result {
            Ok(final_path) => {
                let path_str = final_path.to_string_lossy().to_string();
                item.status = "completed".to_string();
                item.progress = 100.0;
                item.speed.clear();
                item.eta.clear();
                item.file_path = Some(path_str.clone());
                item.error = None;
                let _ = self.db.upsert_download(&item);
                let _ = self.db.mark_track_downloaded(
                    &track.video_id,
                    &path_str,
                    Some(&settings.format.to_uppercase()),
                    None,
                );
                let _ = app.emit("download-updated", &item);
            }
            Err(e) => {
                item.status = "failed".to_string();
                item.error = Some(e.to_string());
                let _ = self.db.upsert_download(&item);
                let _ = app.emit("download-updated", &item);
            }
        }
    }

    async fn execute_ytdlp_download(
        &self,
        app: &AppHandle,
        item: &mut DownloadItem,
        track: &Track,
        settings: &DownloadSettings,
        streaming_quality: &str,
        cancel_flag: &Arc<AtomicBool>,
    ) -> Result<PathBuf> {
        let ytdlp = self.binaries.ensure_ytdlp().await?;
        let ffmpeg = self.binaries.resolve_ffmpeg();

        let base_dir = PathBuf::from(&settings.directory);
        let relative = render_filename_template(&settings.filename_template, track);
        let target_stem = base_dir.join(relative);
        if let Some(parent) = target_stem.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let output_tpl = format!("{}.%(ext)s", target_stem.to_string_lossy());

        let selector = YtDlpResolver::format_selector(streaming_quality, self.auth.is_logged_in());
        let url = format!("https://music.youtube.com/watch?v={}", track.video_id);

        let mut cmd = hidden_command(&ytdlp);
        cmd.args([
            "--newline",
            "--no-playlist",
            "--no-warnings",
            "--progress-template",
            "download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
            "--print",
            "after_move:FINALPATH|%(filepath)s",
            "-f",
            selector,
            "-o",
            &output_tpl,
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

        match settings.format.as_str() {
            "original" => {
                if ffmpeg.is_some() {
                    cmd.args(["--add-metadata"]);
                }
            }
            "opus" => {
                cmd.args(["-x", "--audio-format", "opus", "--audio-quality", "0", "--add-metadata"]);
            }
            "m4a" => {
                cmd.args(["-x", "--audio-format", "m4a", "--audio-quality", "0", "--add-metadata"]);
            }
            "mp3" => {
                cmd.args(["-x", "--audio-format", "mp3", "--audio-quality", "320K", "--add-metadata"]);
            }
            "flac" => {
                cmd.args(["-x", "--audio-format", "flac", "--add-metadata"]);
            }
            _ => {}
        }

        cmd.arg(&url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().context("Failed to spawn yt-dlp download process")?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("Missing stdout"))?;
        let mut reader = BufReader::new(stdout).lines();

        let mut final_path: Option<PathBuf> = None;

        while let Ok(Some(line)) = reader.next_line().await {
            if cancel_flag.load(Ordering::Acquire) {
                let _ = child.kill().await;
                return Err(anyhow!("Download cancelled"));
            }
            if let Some(rest) = line.strip_prefix("PROG|") {
                let parts: Vec<&str> = rest.split('|').collect();
                if parts.len() >= 3 {
                    let pct = parts[0]
                        .trim()
                        .trim_end_matches('%')
                        .parse::<f32>()
                        .unwrap_or(item.progress);
                    item.progress = pct.clamp(0.0, 99.0);
                    item.speed = parts[1].trim().to_string();
                    item.eta = parts[2].trim().to_string();
                    let _ = app.emit("download-updated", &item);
                }
            } else if let Some(path_str) = line.strip_prefix("FINALPATH|") {
                let trimmed = path_str.trim();
                if !trimmed.is_empty() {
                    final_path = Some(PathBuf::from(trimmed));
                }
            }
        }

        let status = child.wait().await?;
        if !status.success() {
            return Err(anyhow!("yt-dlp exited with status {status}"));
        }

        let resolved_path = final_path.ok_or_else(|| {
            anyhow!("Download finished but output file path could not be determined")
        })?;

        // Post-process tags & embedded album art using pure-Rust `lofty`
        item.status = "processing".to_string();
        item.progress = 99.0;
        let _ = app.emit("download-updated", &item);

        let _ = self
            .embed_metadata_with_lofty(&resolved_path, track, settings.embed_thumbnail)
            .await;

        Ok(resolved_path)
    }

    async fn embed_metadata_with_lofty(
        &self,
        path: &Path,
        track: &Track,
        embed_thumbnail: bool,
    ) -> Result<()> {
        let cover_bytes = if embed_thumbnail && !track.thumbnail.is_empty() {
            self.http
                .get(&track.thumbnail)
                .send()
                .await
                .ok()
                .and_then(|r| if r.status().is_success() { Some(r) } else { None })
                .map(|r| r.bytes())
        } else {
            None
        };
        let cover_data = match cover_bytes {
            Some(fut) => fut.await.ok().map(|b| b.to_vec()),
            None => None,
        };

        let path_owned = path.to_path_buf();
        let title = track.title.clone();
        let artist = track.artist.clone();
        let album = track.album.clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let mut tagged = Probe::open(&path_owned)?.read()?;
            let tag_type = tagged.primary_tag_type();
            let tag = match tagged.primary_tag_mut() {
                Some(t) => t,
                None => {
                    tagged.insert_tag(Tag::new(tag_type));
                    tagged
                        .primary_tag_mut()
                        .ok_or_else(|| anyhow!("Could not create audio tag"))?
                }
            };
            tag.set_title(title);
            tag.set_artist(artist);
            if let Some(alb) = album {
                tag.set_album(alb);
            }
            if let Some(img) = cover_data {
                let mime = if img.starts_with(&[0x89, b'P', b'N', b'G']) {
                    MimeType::Png
                } else {
                    MimeType::Jpeg
                };
                let pic = Picture::new_unchecked(PictureType::CoverFront, Some(mime), None, img);
                tag.push_picture(pic);
            }
            tagged.save_to_path(&path_owned, WriteOptions::default())?;
            Ok(())
        })
        .await??;

        Ok(())
    }
}

pub fn render_filename_template(template: &str, track: &Track) -> PathBuf {
    let artist = sanitize_segment(&track.artist);
    let album = sanitize_segment(track.album.as_deref().unwrap_or("Singles"));
    let title = sanitize_segment(&track.title);

    let replaced = template
        .replace("{artist}", &artist)
        .replace("{album}", &album)
        .replace("{title}", &title)
        .replace("{id}", &track.video_id);

    let mut path = PathBuf::new();
    for seg in replaced.split(&['/', '\\'][..]) {
        let clean = sanitize_segment(seg);
        if !clean.is_empty() && clean != "." && clean != ".." {
            path.push(clean);
        }
    }
    if path.as_os_str().is_empty() {
        path.push(format!("{artist} - {title}"));
    }
    path
}

fn sanitize_segment(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();
    cleaned.trim().trim_end_matches('.').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filename_template_sanitization() {
        let track = Track {
            video_id: "abc123".into(),
            title: "Song: Part 1 / Live?".into(),
            artist: "AC/DC".into(),
            artist_id: None,
            album: Some("Back in Black*".into()),
            album_id: None,
            duration_secs: 200,
            thumbnail: String::new(),
            is_explicit: false,
            like_status: None,
            loudness_db: None,
            local_path: None,
            is_downloaded: false,
            codec: None,
            bitrate_kbps: None,
            set_video_id: None,
        };
        let p = render_filename_template("{artist}/{album}/{title}", &track);
        let s = p.to_string_lossy().replace('\\', "/");
        assert_eq!(s, "AC_DC/Back in Black_/Song_ Part 1 _ Live_");
    }
}
