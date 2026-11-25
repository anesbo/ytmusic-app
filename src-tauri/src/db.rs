use std::path::Path;
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{AppSettings, DownloadItem, LocalPlaylistSummary, Track};

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path).context("Failed to open SQLite database")?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            ",
        )?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tracks (
                video_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                artist_id TEXT,
                album TEXT,
                album_id TEXT,
                duration_secs INTEGER NOT NULL DEFAULT 0,
                thumbnail TEXT NOT NULL DEFAULT '',
                is_explicit INTEGER NOT NULL DEFAULT 0,
                like_status TEXT,
                loudness_db REAL,
                local_path TEXT,
                is_downloaded INTEGER NOT NULL DEFAULT 0,
                codec TEXT,
                bitrate_kbps INTEGER,
                play_count INTEGER NOT NULL DEFAULT 0,
                last_played INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                thumbnail TEXT,
                is_synced INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL,
                video_id TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                added_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (playlist_id, video_id),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (video_id) REFERENCES tracks(video_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT,
                thumbnail TEXT NOT NULL DEFAULT '',
                duration_secs INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                progress REAL NOT NULL DEFAULT 0.0,
                speed TEXT NOT NULL DEFAULT '',
                eta TEXT NOT NULL DEFAULT '',
                format TEXT NOT NULL DEFAULT 'original',
                file_path TEXT,
                error TEXT,
                created_at INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS listening_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL,
                played_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_history_played_at ON listening_history(played_at DESC);
            CREATE INDEX IF NOT EXISTS idx_tracks_downloaded ON tracks(is_downloaded);
            CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
            ",
        )?;
        Ok(())
    }

    pub fn load_settings(&self, default_download_dir: &str) -> Result<AppSettings> {
        let conn = self.conn.lock().unwrap();
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app_settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;

        let mut settings = match raw {
            Some(json) => serde_json::from_str::<AppSettings>(&json).unwrap_or_default(),
            None => AppSettings::default(),
        };

        if settings.downloads.directory.trim().is_empty() {
            settings.downloads.directory = default_download_dir.to_string();
        }
        Ok(settings)
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        let json = serde_json::to_string(settings)?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app_settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![json],
        )?;
        Ok(())
    }

    pub fn upsert_track(&self, track: &Track) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tracks (
                video_id, title, artist, artist_id, album, album_id, duration_secs,
                thumbnail, is_explicit, like_status, loudness_db, local_path,
                is_downloaded, codec, bitrate_kbps
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(video_id) DO UPDATE SET
                title = excluded.title,
                artist = excluded.artist,
                artist_id = COALESCE(excluded.artist_id, tracks.artist_id),
                album = COALESCE(excluded.album, tracks.album),
                album_id = COALESCE(excluded.album_id, tracks.album_id),
                duration_secs = CASE WHEN excluded.duration_secs > 0 THEN excluded.duration_secs ELSE tracks.duration_secs END,
                thumbnail = CASE WHEN excluded.thumbnail != '' THEN excluded.thumbnail ELSE tracks.thumbnail END,
                is_explicit = excluded.is_explicit,
                like_status = COALESCE(excluded.like_status, tracks.like_status),
                loudness_db = COALESCE(excluded.loudness_db, tracks.loudness_db),
                local_path = COALESCE(excluded.local_path, tracks.local_path),
                is_downloaded = MAX(tracks.is_downloaded, excluded.is_downloaded),
                codec = COALESCE(excluded.codec, tracks.codec),
                bitrate_kbps = COALESCE(excluded.bitrate_kbps, tracks.bitrate_kbps)",
            params![
                track.video_id,
                track.title,
                track.artist,
                track.artist_id,
                track.album,
                track.album_id,
                track.duration_secs as i64,
                track.thumbnail,
                if track.is_explicit { 1 } else { 0 },
                track.like_status,
                track.loudness_db,
                track.local_path,
                if track.is_downloaded { 1 } else { 0 },
                track.codec,
                track.bitrate_kbps.map(|v| v as i64),
            ],
        )?;
        Ok(())
    }

    pub fn get_track(&self, video_id: &str) -> Result<Option<Track>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT video_id, title, artist, artist_id, album, album_id, duration_secs,
                        thumbnail, is_explicit, like_status, loudness_db, local_path,
                        is_downloaded, codec, bitrate_kbps
                 FROM tracks WHERE video_id = ?1",
                params![video_id],
                Self::map_track_row,
            )
            .optional()?;
        Ok(row)
    }

    pub fn mark_track_downloaded(
        &self,
        video_id: &str,
        local_path: &str,
        codec: Option<&str>,
        bitrate_kbps: Option<u32>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks
             SET local_path = ?2, is_downloaded = 1, codec = COALESCE(?3, codec), bitrate_kbps = COALESCE(?4, bitrate_kbps)
             WHERE video_id = ?1",
            params![video_id, local_path, codec, bitrate_kbps.map(|v| v as i64)],
        )?;
        Ok(())
    }

    pub fn clear_track_download(&self, video_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks SET local_path = NULL, is_downloaded = 0 WHERE video_id = ?1",
            params![video_id],
        )?;
        Ok(())
    }

    pub fn set_track_like_status(&self, video_id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks SET like_status = ?2 WHERE video_id = ?1",
            params![video_id, status],
        )?;
        Ok(())
    }

    pub fn record_play(&self, track: &Track) -> Result<()> {
        self.upsert_track(track)?;
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks SET play_count = play_count + 1, last_played = ?2 WHERE video_id = ?1",
            params![track.video_id, now],
        )?;
        conn.execute(
            "INSERT INTO listening_history (video_id, played_at) VALUES (?1, ?2)",
            params![track.video_id, now],
        )?;
        Ok(())
    }

    pub fn get_downloaded_tracks(&self) -> Result<Vec<Track>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT video_id, title, artist, artist_id, album, album_id, duration_secs,
                    thumbnail, is_explicit, like_status, loudness_db, local_path,
                    is_downloaded, codec, bitrate_kbps
             FROM tracks
             WHERE is_downloaded = 1
             ORDER BY last_played DESC, title ASC",
        )?;
        let rows = stmt
            .query_map([], Self::map_track_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_liked_tracks_local(&self) -> Result<Vec<Track>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT video_id, title, artist, artist_id, album, album_id, duration_secs,
                    thumbnail, is_explicit, like_status, loudness_db, local_path,
                    is_downloaded, codec, bitrate_kbps
             FROM tracks
             WHERE like_status = 'LIKE'
             ORDER BY last_played DESC, title ASC",
        )?;
        let rows = stmt
            .query_map([], Self::map_track_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_recent_history(&self, limit: usize) -> Result<Vec<Track>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.video_id, t.title, t.artist, t.artist_id, t.album, t.album_id, t.duration_secs,
                    t.thumbnail, t.is_explicit, t.like_status, t.loudness_db, t.local_path,
                    t.is_downloaded, t.codec, t.bitrate_kbps
             FROM tracks t
             JOIN (
                 SELECT video_id, MAX(played_at) AS max_played
                 FROM listening_history
                 GROUP BY video_id
             ) h ON h.video_id = t.video_id
             ORDER BY h.max_played DESC
             LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit as i64], Self::map_track_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn upsert_download(&self, item: &DownloadItem) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO downloads (
                id, video_id, title, artist, album, thumbnail, duration_secs,
                status, progress, speed, eta, format, file_path, error, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                progress = excluded.progress,
                speed = excluded.speed,
                eta = excluded.eta,
                format = excluded.format,
                file_path = COALESCE(excluded.file_path, downloads.file_path),
                error = excluded.error",
            params![
                item.id,
                item.video_id,
                item.title,
                item.artist,
                item.album,
                item.thumbnail,
                item.duration_secs as i64,
                item.status,
                item.progress,
                item.speed,
                item.eta,
                item.format,
                item.file_path,
                item.error,
                item.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_downloads(&self) -> Result<Vec<DownloadItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, video_id, title, artist, album, thumbnail, duration_secs,
                    status, progress, speed, eta, format, file_path, error, created_at
             FROM downloads
             ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DownloadItem {
                    id: row.get(0)?,
                    video_id: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    album: row.get(4)?,
                    thumbnail: row.get(5)?,
                    duration_secs: row.get::<_, i64>(6)? as u64,
                    status: row.get(7)?,
                    progress: row.get(8)?,
                    speed: row.get(9)?,
                    eta: row.get(10)?,
                    format: row.get(11)?,
                    file_path: row.get(12)?,
                    error: row.get(13)?,
                    created_at: row.get(14)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn delete_download(&self, id: &str) -> Result<Option<DownloadItem>> {
        let conn = self.conn.lock().unwrap();
        let item = conn
            .query_row(
                "SELECT id, video_id, title, artist, album, thumbnail, duration_secs,
                        status, progress, speed, eta, format, file_path, error, created_at
                 FROM downloads WHERE id = ?1",
                params![id],
                |row| {
                    Ok(DownloadItem {
                        id: row.get(0)?,
                        video_id: row.get(1)?,
                        title: row.get(2)?,
                        artist: row.get(3)?,
                        album: row.get(4)?,
                        thumbnail: row.get(5)?,
                        duration_secs: row.get::<_, i64>(6)? as u64,
                        status: row.get(7)?,
                        progress: row.get(8)?,
                        speed: row.get(9)?,
                        eta: row.get(10)?,
                        format: row.get(11)?,
                        file_path: row.get(12)?,
                        error: row.get(13)?,
                        created_at: row.get(14)?,
                    })
                },
            )
            .optional()?;
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
        Ok(item)
    }

    pub fn create_local_playlist(&self, id: &str, title: &str, description: Option<&str>) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO playlists (id, title, description, is_synced, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
            params![id, title, description, now],
        )?;
        Ok(())
    }

    pub fn add_track_to_local_playlist(&self, playlist_id: &str, track: &Track) -> Result<()> {
        self.upsert_track(track)?;
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        let next_pos: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, video_id, position, added_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![playlist_id, track.video_id, next_pos, now],
        )?;
        conn.execute(
            "UPDATE playlists SET thumbnail = COALESCE(thumbnail, ?2) WHERE id = ?1",
            params![playlist_id, track.thumbnail],
        )?;
        Ok(())
    }

    pub fn remove_track_from_local_playlist(&self, playlist_id: &str, video_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND video_id = ?2",
            params![playlist_id, video_id],
        )?;
        Ok(())
    }

    pub fn delete_local_playlist(&self, playlist_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])?;
        Ok(())
    }

    pub fn list_local_playlists(&self) -> Result<Vec<LocalPlaylistSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT p.id, p.title, p.description, p.thumbnail, p.is_synced,
                    (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS cnt
             FROM playlists p
             ORDER BY p.created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LocalPlaylistSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    thumbnail: row.get(3)?,
                    is_synced: row.get::<_, i64>(4)? != 0,
                    track_count: row.get::<_, i64>(5)? as usize,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_local_playlist_tracks(&self, playlist_id: &str) -> Result<(String, Option<String>, Vec<Track>)> {
        let conn = self.conn.lock().unwrap();
        let (title, desc): (String, Option<String>) = conn.query_row(
            "SELECT title, description FROM playlists WHERE id = ?1",
            params![playlist_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut stmt = conn.prepare(
            "SELECT t.video_id, t.title, t.artist, t.artist_id, t.album, t.album_id, t.duration_secs,
                    t.thumbnail, t.is_explicit, t.like_status, t.loudness_db, t.local_path,
                    t.is_downloaded, t.codec, t.bitrate_kbps
             FROM playlist_tracks pt
             JOIN tracks t ON t.video_id = pt.video_id
             WHERE pt.playlist_id = ?1
             ORDER BY pt.position ASC",
        )?;
        let tracks = stmt
            .query_map(params![playlist_id], Self::map_track_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((title, desc, tracks))
    }

    pub fn save_kv(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn load_kv(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let val = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(val)
    }

    fn map_track_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
        Ok(Track {
            video_id: row.get(0)?,
            title: row.get(1)?,
            artist: row.get(2)?,
            artist_id: row.get(3)?,
            album: row.get(4)?,
            album_id: row.get(5)?,
            duration_secs: row.get::<_, i64>(6)? as u64,
            thumbnail: row.get(7)?,
            is_explicit: row.get::<_, i64>(8)? != 0,
            like_status: row.get(9)?,
            loudness_db: row.get(10)?,
            local_path: row.get(11)?,
            is_downloaded: row.get::<_, i64>(12)? != 0,
            codec: row.get(13)?,
            bitrate_kbps: row.get::<_, Option<i64>>(14)?.map(|v| v as u32),
            set_video_id: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_and_playlist_roundtrip() {
        let db = Database::open_in_memory().unwrap();
        let mut settings = db.load_settings("C:/Music").unwrap();
        assert_eq!(settings.downloads.directory, "C:/Music");
        settings.glass.blur_px = 42;
        settings.audio.eq.enabled = true;
        settings.audio.eq.bands[0] = 4.5;
        db.save_settings(&settings).unwrap();

        let loaded = db.load_settings("C:/Fallback").unwrap();
        assert_eq!(loaded.glass.blur_px, 42);
        assert!(loaded.audio.eq.enabled);
        assert!((loaded.audio.eq.bands[0] - 4.5).abs() < 1e-5);

        db.create_local_playlist("local_1", "Late Night", Some("Chill vibes"))
            .unwrap();
        let track = Track {
            video_id: "dQw4w9WgXcQ".into(),
            title: "Test Track".into(),
            artist: "Test Artist".into(),
            artist_id: None,
            album: Some("Test Album".into()),
            album_id: None,
            duration_secs: 212,
            thumbnail: "https://example.com/thumb.jpg".into(),
            is_explicit: false,
            like_status: Some("LIKE".into()),
            loudness_db: Some(-6.2),
            local_path: None,
            is_downloaded: false,
            codec: None,
            bitrate_kbps: None,
            set_video_id: None,
        };
        db.add_track_to_local_playlist("local_1", &track).unwrap();
        let (title, _desc, tracks) = db.get_local_playlist_tracks("local_1").unwrap();
        assert_eq!(title, "Late Night");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].video_id, "dQw4w9WgXcQ");
    }
}
