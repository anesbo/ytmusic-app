use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use sha1::{Digest, Sha1};

use crate::db::Database;
use crate::models::{PlaylistDetail, Track};

const AUDIO_EXTENSIONS: &[&str] = &[
    "flac", "mp3", "opus", "m4a", "ogg", "wav", "webm", "aac", "alac", "wma",
];

/// Recursively scans local music directories, extracts metadata with `lofty`,
/// and upserts tracks into SQLite so they play instantly offline alongside YouTube Music.
pub fn scan_local_folders(db: &Database, folders: &[String]) -> Result<usize> {
    let mut imported = 0usize;
    for folder in folders {
        let root = Path::new(folder);
        if !root.is_dir() {
            continue;
        }
        let mut files = Vec::new();
        collect_audio_files(root, &mut files, 0);
        for file_path in files {
            if let Ok(track) = probe_local_audio_file(&file_path) {
                if db.upsert_track(&track).is_ok() {
                    imported += 1;
                }
            }
        }
    }
    Ok(imported)
}

fn collect_audio_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_audio_files(&path, out, depth + 1);
        } else if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let lower = ext.to_lowercase();
                if AUDIO_EXTENSIONS.contains(&lower.as_str()) {
                    out.push(path);
                }
            }
        }
    }
}

pub fn probe_local_audio_file(path: &Path) -> Result<Track> {
    let abs_str = path.to_string_lossy().to_string();
    let mut hasher = Sha1::new();
    hasher.update(abs_str.as_bytes());
    let hash_hex = hex::encode(hasher.finalize());
    let video_id = format!("localfile_{}", &hash_hex[..16]);

    let file_stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Track")
        .to_string();

    // Parse fallback "Artist - Title" from filename
    let (fallback_artist, fallback_title) = if let Some((a, t)) = file_stem.split_once(" - ") {
        (a.trim().to_string(), t.trim().to_string())
    } else {
        ("Local Library".to_string(), file_stem)
    };

    let ext_upper = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_uppercase())
        .unwrap_or_else(|| "AUDIO".to_string());

    let mut title = fallback_title;
    let mut artist = fallback_artist;
    let mut album: Option<String> = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());
    let mut duration_secs = 0u64;
    let mut bitrate_kbps: Option<u32> = None;
    let mut thumbnail = String::new();

    if let Ok(probe) = Probe::open(path) {
        if let Ok(tagged) = probe.read() {
            let props = tagged.properties();
            duration_secs = props.duration().as_secs();
            bitrate_kbps = props.audio_bitrate().or_else(|| props.overall_bitrate());

            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                if let Some(t) = tag.title() {
                    if !t.trim().is_empty() {
                        title = t.trim().to_string();
                    }
                }
                if let Some(a) = tag.artist() {
                    if !a.trim().is_empty() {
                        artist = a.trim().to_string();
                    }
                }
                if let Some(al) = tag.album() {
                    if !al.trim().is_empty() {
                        album = Some(al.trim().to_string());
                    }
                }
                // Extract embedded album artwork as lightweight data URL when <= 240 KB
                if let Some(pic) = tag.pictures().first() {
                    let bytes = pic.data();
                    if !bytes.is_empty() && bytes.len() <= 240 * 1024 {
                        let mime = pic
                            .mime_type()
                            .map(|m| m.as_str())
                            .unwrap_or("image/jpeg");
                        thumbnail = format!("data:{mime};base64,{}", encode_base64(bytes));
                    }
                }
            }
        }
    }

    Ok(Track {
        video_id,
        title,
        artist,
        artist_id: None,
        album,
        album_id: None,
        duration_secs,
        thumbnail,
        is_explicit: false,
        like_status: None,
        loudness_db: None,
        local_path: Some(abs_str),
        is_downloaded: true,
        codec: Some(ext_upper),
        bitrate_kbps,
        set_video_id: None,
    })
}

/// Writes updated ID3 / Vorbis / MP4 / FLAC tags directly to the local audio file via `lofty`.
pub fn write_local_track_tags(
    path: &Path,
    title: &str,
    artist: &str,
    album: Option<&str>,
) -> Result<()> {
    let mut tagged = Probe::open(path)?.read()?;
    let tag_type = tagged.primary_tag_type();
    if tagged.primary_tag_mut().is_none() {
        tagged.insert_tag(lofty::tag::Tag::new(tag_type));
    }
    if let Some(tag) = tagged.primary_tag_mut() {
        tag.set_title(title.to_string());
        tag.set_artist(artist.to_string());
        if let Some(alb) = album.filter(|s| !s.trim().is_empty()) {
            tag.set_album(alb.to_string());
        } else {
            tag.remove_album();
        }
    }
    tagged.save_to_path(path, lofty::config::WriteOptions::default())?;
    Ok(())
}

/// Opens the containing folder and highlights the file in Windows Explorer / macOS Finder / Linux file manager.
pub fn reveal_in_file_manager(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path.to_string_lossy()])
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(parent) = path.parent() {
            std::process::Command::new("xdg-open").arg(parent).spawn()?;
        }
    }
    Ok(())
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Exports a playlist as standard `#EXTM3U` (`.m3u8`) or full `.json` backup.
pub fn export_playlist_to_file(
    detail: &PlaylistDetail,
    format: &str,
    out_path: &Path,
) -> Result<String> {
    if format.eq_ignore_ascii_case("json") {
        let json = serde_json::to_string_pretty(detail)?;
        std::fs::write(out_path, json)?;
    } else {
        let mut out = String::from("#EXTM3U\n");
        out.push_str(&format!("#PLAYLIST:{}\n", detail.title));
        for t in &detail.tracks {
            let dur = t.duration_secs as i64;
            out.push_str(&format!("#EXTINF:{},{} - {}\n", dur, t.artist, t.title));
            if let Some(local) = &t.local_path {
                out.push_str(local);
            } else {
                out.push_str(&format!("https://music.youtube.com/watch?v={}", t.video_id));
            }
            out.push('\n');
        }
        std::fs::write(out_path, out)?;
    }
    Ok(out_path.to_string_lossy().to_string())
}

/// Imports tracks from a `.json` playlist backup or `.m3u` / `.m3u8` file into a new local playlist.
pub fn import_playlist_from_file(db: &Database, path: &Path) -> Result<(String, usize)> {
    let raw = std::fs::read_to_string(path)?;
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported Playlist")
        .to_string();

    let (title, description, tracks) = if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
    {
        let parsed: PlaylistDetail = serde_json::from_str(&raw)?;
        (parsed.title, parsed.description, parsed.tracks)
    } else {
        parse_m3u(&raw, &stem)
    };

    if tracks.is_empty() {
        return Err(anyhow!("No tracks found in {}", path.display()));
    }

    let id = format!("local_{}", uuid::Uuid::new_v4().simple());
    db.create_local_playlist(&id, &title, description.as_deref())?;
    for track in &tracks {
        let _ = db.add_track_to_local_playlist(&id, track);
    }
    Ok((id, tracks.len()))
}

fn parse_m3u(content: &str, fallback_title: &str) -> (String, Option<String>, Vec<Track>) {
    let mut title = fallback_title.to_string();
    let mut tracks = Vec::new();
    let mut pending_meta: Option<(u64, String, String)> = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(pl) = line.strip_prefix("#PLAYLIST:") {
            let trimmed = pl.trim();
            if !trimmed.is_empty() {
                title = trimmed.to_string();
            }
            continue;
        }
        if let Some(info) = line.strip_prefix("#EXTINF:") {
            if let Some((dur_str, label)) = info.split_once(',') {
                let dur = dur_str.trim().parse::<i64>().unwrap_or(0).max(0) as u64;
                let (artist, song) = if let Some((a, t)) = label.split_once(" - ") {
                    (a.trim().to_string(), t.trim().to_string())
                } else {
                    ("Unknown Artist".to_string(), label.trim().to_string())
                };
                pending_meta = Some((dur, artist, song));
            }
            continue;
        }
        if line.starts_with('#') {
            continue;
        }

        // URL or local path
        if let Some(vid) = extract_youtube_video_id(line) {
            let (dur, artist, song) = pending_meta
                .take()
                .unwrap_or((0, "YouTube Music".to_string(), vid.clone()));
            tracks.push(Track {
                video_id: vid,
                title: song,
                artist,
                artist_id: None,
                album: None,
                album_id: None,
                duration_secs: dur,
                thumbnail: String::new(),
                is_explicit: false,
                like_status: None,
                loudness_db: None,
                local_path: None,
                is_downloaded: false,
                codec: None,
                bitrate_kbps: None,
                set_video_id: None,
            });
        } else {
            let p = Path::new(line);
            if p.is_file() {
                if let Ok(mut tr) = probe_local_audio_file(p) {
                    if let Some((dur, artist, song)) = pending_meta.take() {
                        if tr.duration_secs == 0 {
                            tr.duration_secs = dur;
                        }
                        if tr.artist == "Local Library" {
                            tr.artist = artist;
                        }
                        if tr.title.is_empty() {
                            tr.title = song;
                        }
                    }
                    tracks.push(tr);
                }
            }
            pending_meta = None;
        }
    }

    (title, Some("Imported from M3U playlist".to_string()), tracks)
}

pub fn extract_youtube_playlist_id(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.starts_with("PL") || trimmed.starts_with("VL") || trimmed.starts_with("OLAK5") {
        return Some(trimmed.to_string());
    }
    if let Ok(parsed) = url::Url::parse(trimmed) {
        for (k, v) in parsed.query_pairs() {
            if k == "list" && !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn extract_youtube_video_id(input: &str) -> Option<String> {
    let parsed = url::Url::parse(input).ok()?;
    let host = parsed.host_str()?;
    if host.contains("youtu.be") {
        return parsed
            .path_segments()
            .and_then(|mut s| s.next())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
    }
    if host.contains("youtube.com") {
        for (k, v) in parsed.query_pairs() {
            if k == "v" && !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}
