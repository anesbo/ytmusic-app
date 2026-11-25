use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT};
use serde_json::{json, Value};

use crate::auth::AuthManager;
use crate::models::{
    ArtistDetail, ExploreResponse, HomeResponse, LyricsData, MoodChip, PlaylistDetail,
    SearchResponse, Shelf, ShelfItem, SyncedLyricLine, Track, WatchPlaylistResponse,
};

const INNERTUBE_BASE: &str = "https://music.youtube.com/youtubei/v1";
const YTM_ORIGIN: &str = "https://music.youtube.com";
const CLIENT_VERSION: &str = "1.20250101.01.00";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

pub struct InnerTubeClient {
    http: reqwest::Client,
    auth: Arc<AuthManager>,
}

impl InnerTubeClient {
    pub fn new(auth: Arc<AuthManager>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()?;
        Ok(Self { http, auth })
    }

    fn context_payload() -> Value {
        json!({
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": CLIENT_VERSION,
                "hl": "en",
                "gl": "US",
                "platform": "DESKTOP"
            }
        })
    }

    async fn post(&self, endpoint: &str, mut body: Value) -> Result<Value> {
        if let Some(obj) = body.as_object_mut() {
            obj.insert("context".to_string(), Self::context_payload());
        }

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(BROWSER_UA));
        headers.insert(ORIGIN, HeaderValue::from_static(YTM_ORIGIN));
        headers.insert(REFERER, HeaderValue::from_static("https://music.youtube.com/"));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert("X-Origin", HeaderValue::from_static(YTM_ORIGIN));
        headers.insert("X-YouTube-Client-Name", HeaderValue::from_static("67"));
        headers.insert("X-YouTube-Client-Version", HeaderValue::from_static(CLIENT_VERSION));

        if let Some(cookie) = self.auth.cookie_header() {
            if let Ok(val) = HeaderValue::from_str(&cookie) {
                headers.insert(COOKIE, val);
            }
        }
        if let Some(auth_hdr) = self.auth.sapisidhash_header() {
            if let Ok(val) = HeaderValue::from_str(&auth_hdr) {
                headers.insert(AUTHORIZATION, val);
            }
        }

        let url = format!("{INNERTUBE_BASE}/{endpoint}?prettyPrint=false");
        let resp = self
            .http
            .post(&url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("InnerTube request failed: {endpoint}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!(
                "InnerTube {endpoint} returned {status}: {}",
                text.chars().take(240).collect::<String>()
            ));
        }

        resp.json::<Value>()
            .await
            .context("Failed to parse InnerTube JSON")
    }

    pub async fn fetch_account_profile(&self) -> Result<()> {
        if !self.auth.is_logged_in() {
            return Ok(());
        }
        let data = self.post("account/account_menu", json!({})).await?;
        let header = find_key(&data, "activeAccountHeaderRenderer");
        if let Some(h) = header {
            let name = extract_text(h.get("accountName"));
            let handle = extract_text(h.get("channelHandle"));
            let avatar = extract_best_thumbnail(h.get("accountPhoto"));
            let raw_str = data.to_string().to_lowercase();
            let is_premium = raw_str.contains("youtube music premium")
                || raw_str.contains("paid_memberships")
                || raw_str.contains("music_premium");
            self.auth.update_profile(
                if name.is_empty() { None } else { Some(name) },
                if handle.is_empty() { None } else { Some(handle) },
                if avatar.is_empty() { None } else { Some(avatar) },
                is_premium,
            );
        }
        Ok(())
    }

    pub async fn get_home(&self, mood_params: Option<&str>) -> Result<HomeResponse> {
        let mut body = json!({ "browseId": "FEmusic_home" });
        if let Some(p) = mood_params {
            if !p.is_empty() {
                body["params"] = json!(p);
            }
        }
        let data = self.post("browse", body).await?;
        let chips = parse_mood_chips(&data);
        let shelves = parse_shelves(&data);
        Ok(HomeResponse { chips, shelves })
    }

    pub async fn get_explore(&self) -> Result<ExploreResponse> {
        let data = self
            .post("browse", json!({ "browseId": "FEmusic_explore" }))
            .await?;
        let moods = parse_explore_moods(&data);
        let shelves = parse_shelves(&data);
        Ok(ExploreResponse { moods, shelves })
    }

    pub async fn get_search_suggestions(&self, query: &str) -> Result<Vec<String>> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }
        let data = self
            .post("music/get_search_suggestions", json!({ "input": query }))
            .await?;
        let mut suggestions = Vec::new();
        collect_search_suggestions(&data, &mut suggestions);
        suggestions.truncate(8);
        Ok(suggestions)
    }

    pub async fn search(&self, query: &str, filter: &str) -> Result<SearchResponse> {
        let mut body = json!({ "query": query });
        if let Some(params) = search_filter_params(filter) {
            body["params"] = json!(params);
        }
        let data = self.post("search", body).await?;
        let top_result = parse_top_result(&data);
        let shelves = parse_shelves(&data);
        Ok(SearchResponse {
            query: query.to_string(),
            filter: filter.to_string(),
            top_result,
            shelves,
        })
    }

    pub async fn get_artist(&self, browse_id: &str) -> Result<ArtistDetail> {
        let data = self
            .post("browse", json!({ "browseId": browse_id }))
            .await?;

        let header = find_key(&data, "musicImmersiveHeaderRenderer")
            .or_else(|| find_key(&data, "musicVisualHeaderRenderer"))
            .or_else(|| find_key(&data, "musicHeaderRenderer"));

        let name = header
            .and_then(|h| h.get("title"))
            .map(|v| extract_text(Some(v)))
            .unwrap_or_else(|| "Artist".to_string());
        let description = header
            .and_then(|h| h.get("description"))
            .map(|v| extract_text(Some(v)))
            .filter(|s| !s.is_empty());
        let thumbnail = header
            .and_then(|h| h.get("thumbnail").or_else(|| h.get("foregroundThumbnail")))
            .map(|v| extract_best_thumbnail(Some(v)))
            .unwrap_or_default();

        let sub_btn = header.and_then(|h| find_key(h, "subscribeButtonRenderer"));
        let subscribers = sub_btn
            .and_then(|s| s.get("longSubscriberCountText").or_else(|| s.get("shortSubscriberCountText")))
            .map(|v| extract_text(Some(v)))
            .filter(|s| !s.is_empty());
        let subscribed = sub_btn
            .and_then(|s| s.get("subscribed"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let channel_id = sub_btn
            .and_then(|s| s.get("channelId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let shelves = parse_shelves(&data);
        let mut top_songs = Vec::new();
        let mut other_shelves = Vec::new();
        for shelf in shelves {
            if shelf.title.eq_ignore_ascii_case("Songs") && top_songs.is_empty() {
                for item in &shelf.items {
                    if item.kind == "song" || item.kind == "video" {
                        top_songs.push(shelf_item_to_track(item));
                    }
                }
            } else {
                other_shelves.push(shelf);
            }
        }

        Ok(ArtistDetail {
            browse_id: browse_id.to_string(),
            name,
            description,
            subscribers,
            subscribed,
            channel_id,
            thumbnail,
            top_songs,
            shelves: other_shelves,
        })
    }

    pub async fn get_playlist(&self, browse_or_list_id: &str) -> Result<PlaylistDetail> {
        let browse_id = if browse_or_list_id.starts_with("VL")
            || browse_or_list_id.starts_with("MPREb_")
            || browse_or_list_id.starts_with("OLAK5uy_")
            || browse_or_list_id.starts_with("FE")
        {
            browse_or_list_id.to_string()
        } else {
            format!("VL{browse_or_list_id}")
        };

        let data = self
            .post("browse", json!({ "browseId": browse_id }))
            .await?;

        let header = find_key(&data, "musicResponsiveHeaderRenderer")
            .or_else(|| find_key(&data, "musicDetailHeaderRenderer"))
            .or_else(|| find_key(&data, "musicEditablePlaylistDetailHeaderRenderer"));

        let title = header
            .and_then(|h| h.get("title").or_else(|| find_key(h, "title")))
            .map(|v| extract_text(Some(v)))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Playlist".to_string());

        let subtitle = header
            .and_then(|h| h.get("subtitle"))
            .map(|v| extract_text(Some(v)))
            .unwrap_or_default();

        let description = header
            .and_then(|h| h.get("description"))
            .map(|v| extract_text(Some(v)))
            .filter(|s| !s.is_empty());

        let total_duration_text = header
            .and_then(|h| h.get("secondSubtitle"))
            .map(|v| extract_text(Some(v)))
            .filter(|s| !s.is_empty());

        let thumbnail = header
            .and_then(|h| h.get("thumbnail"))
            .map(|v| extract_best_thumbnail(Some(v)))
            .unwrap_or_default();

        let is_album = browse_id.starts_with("MPREb_")
            || subtitle.to_lowercase().contains("album")
            || subtitle.to_lowercase().contains("ep")
            || subtitle.to_lowercase().contains("single");

        let mut tracks = Vec::new();
        collect_responsive_tracks(&data, &mut tracks, if is_album { Some(&title) } else { None }, if is_album { Some(&thumbnail) } else { None });

        // Fetch one continuation page if available for larger playlists
        if let Some(token) = find_continuation_token(&data) {
            if let Ok(cont_data) = self
                .post("browse", json!({ "continuation": token }))
                .await
            {
                collect_responsive_tracks(
                    &cont_data,
                    &mut tracks,
                    if is_album { Some(&title) } else { None },
                    if is_album { Some(&thumbnail) } else { None },
                );
            }
        }

        let track_count = tracks.len();
        Ok(PlaylistDetail {
            id: browse_or_list_id.to_string(),
            title,
            subtitle,
            description,
            thumbnail: if thumbnail.is_empty() {
                tracks.first().map(|t| t.thumbnail.clone()).unwrap_or_default()
            } else {
                thumbnail
            },
            track_count,
            total_duration_text,
            is_album,
            is_local: false,
            tracks,
        })
    }

    pub async fn get_library_playlists(&self) -> Result<Vec<ShelfItem>> {
        if !self.auth.is_logged_in() {
            return Ok(vec![]);
        }
        let data = self
            .post("browse", json!({ "browseId": "FEmusic_liked_playlists" }))
            .await?;
        let mut items = Vec::new();
        let shelves = parse_shelves(&data);
        for s in shelves {
            items.extend(s.items);
        }
        if items.is_empty() {
            collect_two_row_items(&data, &mut items);
        }
        Ok(items)
    }

    pub async fn get_liked_songs(&self) -> Result<PlaylistDetail> {
        self.get_playlist("VLLM").await
    }

    pub async fn get_watch_playlist(
        &self,
        video_id: &str,
        playlist_id: Option<&str>,
    ) -> Result<WatchPlaylistResponse> {
        let pl_id = playlist_id
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("RDAMVM{video_id}"));

        let data = self
            .post(
                "next",
                json!({
                    "videoId": video_id,
                    "playlistId": pl_id,
                    "isAudioOnly": true,
                    "enablePersistentPlaylistPanel": true,
                    "tunerSettingValue": "AUTOMIX_SETTING_NORMAL"
                }),
            )
            .await?;

        let mut tracks = Vec::new();
        collect_playlist_panel_tracks(&data, &mut tracks);

        let mut lyrics_browse_id = None;
        let mut related_browse_id = None;
        if let Some(tabs) = find_key(&data, "tabs").and_then(|v| v.as_array()) {
            for tab in tabs {
                if let Some(tr) = tab.get("tabRenderer") {
                    let title = tr.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let bid = tr
                        .pointer("/endpoint/browseEndpoint/browseId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    if title.eq_ignore_ascii_case("Lyrics") {
                        lyrics_browse_id = bid;
                    } else if title.eq_ignore_ascii_case("Related") {
                        related_browse_id = bid;
                    }
                }
            }
        }

        Ok(WatchPlaylistResponse {
            tracks,
            lyrics_browse_id,
            related_browse_id,
        })
    }

    pub async fn get_related(&self, related_browse_id: &str) -> Result<Vec<Shelf>> {
        let data = self
            .post("browse", json!({ "browseId": related_browse_id }))
            .await?;
        Ok(parse_shelves(&data))
    }

    pub async fn get_lyrics(
        &self,
        video_id: &str,
        title: &str,
        artist: &str,
        duration_secs: u64,
        lyrics_browse_id: Option<&str>,
    ) -> Result<LyricsData> {
        // 1. Try LRCLIB first for time-synced lyrics (best karaoke/auto-scroll experience)
        if let Ok(Some(lrc_data)) = self
            .fetch_lrclib_lyrics(video_id, title, artist, duration_secs)
            .await
        {
            if !lrc_data.synced.is_empty() {
                return Ok(lrc_data);
            }
        }

        // 2. Fallback to YouTube Music's own Lyrics tab via InnerTube
        let browse_id = match lyrics_browse_id {
            Some(id) if !id.is_empty() => Some(id.to_string()),
            _ => self
                .get_watch_playlist(video_id, None)
                .await
                .ok()
                .and_then(|w| w.lyrics_browse_id),
        };

        if let Some(bid) = browse_id {
            if let Ok(data) = self.post("browse", json!({ "browseId": bid })).await {
                if let Some(desc_shelf) = find_key(&data, "musicDescriptionShelfRenderer") {
                    let plain = extract_text(desc_shelf.get("description"));
                    let footer = extract_text(desc_shelf.get("footer"));
                    if !plain.is_empty() {
                        return Ok(LyricsData {
                            video_id: video_id.to_string(),
                            source: if footer.is_empty() {
                                "YouTube Music".to_string()
                            } else {
                                footer
                            },
                            plain: Some(plain),
                            synced: vec![],
                        });
                    }
                }
            }
        }

        // 3. Last attempt: LRCLIB plain lyrics if available
        if let Ok(Some(lrc_data)) = self
            .fetch_lrclib_lyrics(video_id, title, artist, duration_secs)
            .await
        {
            return Ok(lrc_data);
        }

        Ok(LyricsData {
            video_id: video_id.to_string(),
            source: "None".to_string(),
            plain: None,
            synced: vec![],
        })
    }

    async fn fetch_lrclib_lyrics(
        &self,
        video_id: &str,
        title: &str,
        artist: &str,
        duration_secs: u64,
    ) -> Result<Option<LyricsData>> {
        let clean_title = clean_track_title(title);
        let clean_artist = artist.split(&[',', '&', '•'][..]).next().unwrap_or(artist).trim();
        let mut req = self
            .http
            .get("https://lrclib.net/api/get")
            .header(USER_AGENT, "LiquidYTM/0.1 (https://github.com/liquidytm)")
            .query(&[
                ("track_name", clean_title.as_str()),
                ("artist_name", clean_artist),
            ]);
        if duration_secs > 0 {
            req = req.query(&[("duration", duration_secs.to_string())]);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            return Ok(None);
        }
        let v: Value = resp.json().await?;
        let synced_raw = v.get("syncedLyrics").and_then(|s| s.as_str()).unwrap_or("");
        let plain = v
            .get("plainLyrics")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string());
        let synced = parse_lrc(synced_raw);
        if synced.is_empty() && plain.is_none() {
            return Ok(None);
        }
        Ok(Some(LyricsData {
            video_id: video_id.to_string(),
            source: "LRCLIB (Synced)".to_string(),
            plain,
            synced,
        }))
    }

    pub async fn rate_song(&self, video_id: &str, rating: &str) -> Result<()> {
        if !self.auth.is_logged_in() {
            return Err(anyhow!("Sign in to your YouTube Music account to sync likes"));
        }
        let endpoint = match rating {
            "LIKE" => "like/like",
            "DISLIKE" => "like/dislike",
            _ => "like/removelike",
        };
        self.post(endpoint, json!({ "target": { "videoId": video_id } }))
            .await?;
        Ok(())
    }

    pub async fn create_remote_playlist(&self, title: &str, description: &str) -> Result<String> {
        if !self.auth.is_logged_in() {
            return Err(anyhow!("Sign in to create a synced YouTube Music playlist"));
        }
        let data = self
            .post(
                "playlist/create",
                json!({
                    "title": title,
                    "description": description,
                    "privacyStatus": "PRIVATE"
                }),
            )
            .await?;
        let id = data
            .get("playlistId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("YouTube Music did not return a playlistId"))?;
        Ok(id.to_string())
    }

    pub async fn add_to_remote_playlist(&self, playlist_id: &str, video_id: &str) -> Result<()> {
        if !self.auth.is_logged_in() {
            return Err(anyhow!("Sign in to modify synced playlists"));
        }
        let clean_id = playlist_id.strip_prefix("VL").unwrap_or(playlist_id);
        self.post(
            "browse/edit_playlist",
            json!({
                "playlistId": clean_id,
                "actions": [{
                    "action": "ACTION_ADD_VIDEO",
                    "addedVideoId": video_id
                }]
            }),
        )
        .await?;
        Ok(())
    }

    pub async fn set_artist_subscription(&self, channel_id: &str, subscribe: bool) -> Result<()> {
        if !self.auth.is_logged_in() {
            return Err(anyhow!("Sign in to subscribe to artists"));
        }
        let endpoint = if subscribe {
            "subscription/subscribe"
        } else {
            "subscription/unsubscribe"
        };
        self.post(endpoint, json!({ "channelIds": [channel_id] }))
            .await?;
        Ok(())
    }

    pub async fn fetch_track_loudness_db(&self, video_id: &str) -> Option<f32> {
        let data = self
            .post("player", json!({ "videoId": video_id }))
            .await
            .ok()?;
        data.pointer("/playerConfig/audioConfig/loudnessDb")
            .and_then(|v| v.as_f64())
            .map(|v| v as f32)
    }
}

fn search_filter_params(filter: &str) -> Option<&'static str> {
    match filter.to_lowercase().as_str() {
        "songs" => Some("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"),
        "videos" => Some("EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D"),
        "albums" => Some("EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D"),
        "artists" => Some("EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D"),
        "playlists" => Some("EgeKAQQoAEABagoQAxAEEAoQCRAF"),
        _ => None,
    }
}

fn clean_track_title(title: &str) -> String {
    let mut s = title.to_string();
    for marker in ["(Official", "[Official", "(Lyrics", "[Lyrics", "(Audio", "[Audio", "(feat.", "(ft."] {
        if let Some(idx) = s.to_lowercase().find(&marker.to_lowercase()) {
            s.truncate(idx);
        }
    }
    s.trim().to_string()
}

pub fn parse_lrc(lrc: &str) -> Vec<SyncedLyricLine> {
    let mut lines = Vec::new();
    for raw in lrc.lines() {
        let trimmed = raw.trim();
        if !trimmed.starts_with('[') {
            continue;
        }
        if let Some(end) = trimmed.find(']') {
            let tag = &trimmed[1..end];
            let text = trimmed[end + 1..].trim();
            if let Some((min_s, sec_s)) = tag.split_once(':') {
                if let (Ok(min), Ok(sec)) = (min_s.parse::<u64>(), sec_s.parse::<f64>()) {
                    let time_ms = min * 60_000 + (sec * 1000.0).round() as u64;
                    lines.push(SyncedLyricLine {
                        time_ms,
                        text: text.to_string(),
                    });
                }
            }
        }
    }
    lines.sort_by_key(|l| l.time_ms);
    lines
}

pub fn parse_duration_text(text: &str) -> u64 {
    let parts: Vec<&str> = text.trim().split(':').collect();
    match parts.len() {
        2 => {
            let m = parts[0].parse::<u64>().unwrap_or(0);
            let s = parts[1].parse::<u64>().unwrap_or(0);
            m * 60 + s
        }
        3 => {
            let h = parts[0].parse::<u64>().unwrap_or(0);
            let m = parts[1].parse::<u64>().unwrap_or(0);
            let s = parts[2].parse::<u64>().unwrap_or(0);
            h * 3600 + m * 60 + s
        }
        _ => 0,
    }
}

fn extract_text(val: Option<&Value>) -> String {
    let Some(v) = val else { return String::new() };
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    if let Some(s) = v.get("simpleText").and_then(|x| x.as_str()) {
        return s.to_string();
    }
    if let Some(runs) = v.get("runs").and_then(|x| x.as_array()) {
        return runs
            .iter()
            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
            .collect::<String>();
    }
    String::new()
}

fn extract_best_thumbnail(val: Option<&Value>) -> String {
    let Some(v) = val else { return String::new() };
    let thumbs = v
        .pointer("/musicThumbnailRenderer/thumbnail/thumbnails")
        .or_else(|| v.pointer("/thumbnail/thumbnails"))
        .or_else(|| v.get("thumbnails"))
        .and_then(|t| t.as_array());
    if let Some(arr) = thumbs {
        if let Some(best) = arr.iter().max_by_key(|t| t.get("width").and_then(|w| w.as_u64()).unwrap_or(0)) {
            if let Some(url) = best.get("url").and_then(|u| u.as_str()) {
                return upgrade_thumbnail_url(url);
            }
        }
    }
    String::new()
}

fn upgrade_thumbnail_url(url: &str) -> String {
    if url.contains("lh3.googleusercontent.com") {
        if let Some(idx) = url.rfind('=') {
            return format!("{}=w544-h544-l90-rj", &url[..idx]);
        }
    }
    url.to_string()
}

fn find_key<'a>(val: &'a Value, key: &str) -> Option<&'a Value> {
    match val {
        Value::Object(map) => {
            if let Some(found) = map.get(key) {
                return Some(found);
            }
            for v in map.values() {
                if let Some(found) = find_key(v, key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(arr) => {
            for item in arr {
                if let Some(found) = find_key(item, key) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn find_continuation_token(val: &Value) -> Option<String> {
    find_key(val, "nextContinuationData")
        .and_then(|v| v.get("continuation"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn parse_mood_chips(val: &Value) -> Vec<MoodChip> {
    let mut chips = Vec::new();
    if let Some(chip_cloud) = find_key(val, "chipCloudRenderer") {
        if let Some(arr) = chip_cloud.get("chips").and_then(|c| c.as_array()) {
            for c in arr {
                if let Some(cr) = c.get("chipCloudChipRenderer") {
                    let title = extract_text(cr.get("text"));
                    let params = cr
                        .pointer("/navigationEndpoint/browseEndpoint/params")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !title.is_empty() && !params.is_empty() {
                        chips.push(MoodChip { title, params });
                    }
                }
            }
        }
    }
    chips
}

fn parse_explore_moods(val: &Value) -> Vec<MoodChip> {
    let mut moods = Vec::new();
    fn walk(v: &Value, out: &mut Vec<MoodChip>) {
        match v {
            Value::Object(map) => {
                if let Some(btn) = map.get("musicNavigationButtonRenderer") {
                    let title = extract_text(btn.get("buttonText"));
                    let params = btn
                        .pointer("/clickCommand/browseEndpoint/params")
                        .and_then(|p| p.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !title.is_empty() && !params.is_empty() {
                        out.push(MoodChip { title, params });
                    }
                }
                for child in map.values() {
                    walk(child, out);
                }
            }
            Value::Array(arr) => {
                for child in arr {
                    walk(child, out);
                }
            }
            _ => {}
        }
    }
    walk(val, &mut moods);
    moods
}

fn parse_top_result(val: &Value) -> Option<ShelfItem> {
    let card = find_key(val, "musicCardShelfRenderer")?;
    let title = extract_text(card.get("title"));
    let subtitle = extract_text(card.get("subtitle"));
    let thumbnail = extract_best_thumbnail(card.get("thumbnail"));
    if title.is_empty() {
        return None;
    }
    let watch_vid = card
        .pointer("/title/runs/0/navigationEndpoint/watchEndpoint/videoId")
        .or_else(|| card.pointer("/onTap/watchEndpoint/videoId"))
        .and_then(|v| v.as_str());
    let browse_id = card
        .pointer("/title/runs/0/navigationEndpoint/browseEndpoint/browseId")
        .or_else(|| card.pointer("/onTap/browseEndpoint/browseId"))
        .and_then(|v| v.as_str());

    let (kind, id) = if let Some(vid) = watch_vid {
        ("song".to_string(), vid.to_string())
    } else if let Some(bid) = browse_id {
        (classify_browse_id(bid, &subtitle), bid.to_string())
    } else {
        return None;
    };

    Some(ShelfItem {
        kind,
        id,
        title,
        subtitle,
        thumbnail,
        duration_secs: None,
        artist_id: None,
        album_id: None,
        is_explicit: find_key(card, "MUSIC_EXPLICIT_BADGE").is_some(),
    })
}

fn parse_shelves(val: &Value) -> Vec<Shelf> {
    let mut shelves = Vec::new();
    fn walk(v: &Value, out: &mut Vec<Shelf>) {
        match v {
            Value::Object(map) => {
                if let Some(carousel) = map.get("musicCarouselShelfRenderer") {
                    let header = carousel.pointer("/header/musicCarouselShelfBasicHeaderRenderer");
                    let title = extract_text(header.and_then(|h| h.get("title")));
                    let strapline = header
                        .and_then(|h| h.get("strapline"))
                        .map(|s| extract_text(Some(s)))
                        .filter(|s| !s.is_empty());
                    let mut items = Vec::new();
                    let mut has_responsive = false;
                    if let Some(contents) = carousel.get("contents").and_then(|c| c.as_array()) {
                        for entry in contents {
                            if let Some(two_row) = entry.get("musicTwoRowItemRenderer") {
                                if let Some(item) = parse_two_row_item(two_row) {
                                    items.push(item);
                                }
                            } else if let Some(resp) = entry.get("musicResponsiveListItemRenderer") {
                                has_responsive = true;
                                if let Some(item) = parse_responsive_item(resp) {
                                    items.push(item);
                                }
                            }
                        }
                    }
                    if !items.is_empty() {
                        out.push(Shelf {
                            title: if title.is_empty() { "Recommended".to_string() } else { title },
                            strapline,
                            kind: if has_responsive {
                                "quick_picks".to_string()
                            } else {
                                "carousel".to_string()
                            },
                            items,
                        });
                    }
                    return;
                }
                if let Some(shelf) = map.get("musicShelfRenderer") {
                    let title = extract_text(shelf.get("title"));
                    let mut items = Vec::new();
                    if let Some(contents) = shelf.get("contents").and_then(|c| c.as_array()) {
                        for entry in contents {
                            if let Some(resp) = entry.get("musicResponsiveListItemRenderer") {
                                if let Some(item) = parse_responsive_item(resp) {
                                    items.push(item);
                                }
                            }
                        }
                    }
                    if !items.is_empty() {
                        out.push(Shelf {
                            title: if title.is_empty() { "Tracks".to_string() } else { title },
                            strapline: None,
                            kind: "list".to_string(),
                            items,
                        });
                    }
                    return;
                }
                for child in map.values() {
                    walk(child, out);
                }
            }
            Value::Array(arr) => {
                for child in arr {
                    walk(child, out);
                }
            }
            _ => {}
        }
    }
    walk(val, &mut shelves);
    shelves
}

fn collect_two_row_items(val: &Value, out: &mut Vec<ShelfItem>) {
    match val {
        Value::Object(map) => {
            if let Some(two_row) = map.get("musicTwoRowItemRenderer") {
                if let Some(item) = parse_two_row_item(two_row) {
                    out.push(item);
                }
                return;
            }
            for child in map.values() {
                collect_two_row_items(child, out);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                collect_two_row_items(child, out);
            }
        }
        _ => {}
    }
}

fn parse_two_row_item(two_row: &Value) -> Option<ShelfItem> {
    let title = extract_text(two_row.get("title"));
    if title.is_empty() {
        return None;
    }
    let subtitle = extract_text(two_row.get("subtitle"));
    let thumbnail = extract_best_thumbnail(two_row.get("thumbnailRenderer"));
    let nav = two_row.get("navigationEndpoint");
    let video_id = nav
        .and_then(|n| n.pointer("/watchEndpoint/videoId"))
        .and_then(|v| v.as_str());
    let browse_id = nav
        .and_then(|n| n.pointer("/browseEndpoint/browseId"))
        .and_then(|v| v.as_str());
    let watch_playlist_id = nav
        .and_then(|n| n.pointer("/watchPlaylistEndpoint/playlistId"))
        .and_then(|v| v.as_str());

    let (kind, id) = if let Some(vid) = video_id {
        ("song".to_string(), vid.to_string())
    } else if let Some(bid) = browse_id {
        (classify_browse_id(bid, &subtitle), bid.to_string())
    } else if let Some(pid) = watch_playlist_id {
        ("playlist".to_string(), pid.to_string())
    } else {
        return None;
    };

    Some(ShelfItem {
        kind,
        id,
        title,
        subtitle,
        thumbnail,
        duration_secs: None,
        artist_id: None,
        album_id: None,
        is_explicit: find_key(two_row, "MUSIC_EXPLICIT_BADGE").is_some(),
    })
}

fn parse_responsive_item(resp: &Value) -> Option<ShelfItem> {
    let cols = resp.get("flexColumns").and_then(|c| c.as_array())?;
    let col0_text = cols
        .first()
        .and_then(|c| c.pointer("/musicResponsiveListItemFlexColumnRenderer/text"));
    let col1_text = cols
        .get(1)
        .and_then(|c| c.pointer("/musicResponsiveListItemFlexColumnRenderer/text"));

    let title = extract_text(col0_text);
    if title.is_empty() {
        return None;
    }
    let subtitle = extract_text(col1_text);
    let thumbnail = extract_best_thumbnail(resp.get("thumbnail"));

    let video_id = resp
        .pointer("/playlistItemData/videoId")
        .or_else(|| {
            resp.pointer(
                "/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId",
            )
        })
        .or_else(|| col0_text.and_then(|t| t.pointer("/runs/0/navigationEndpoint/watchEndpoint/videoId")))
        .and_then(|v| v.as_str());

    let browse_id = resp
        .pointer("/navigationEndpoint/browseEndpoint/browseId")
        .or_else(|| col0_text.and_then(|t| t.pointer("/runs/0/navigationEndpoint/browseEndpoint/browseId")))
        .and_then(|v| v.as_str());

    let mut artist_id = None;
    let mut album_id = None;
    let mut duration_secs = None;

    if let Some(runs) = col1_text.and_then(|t| t.get("runs")).and_then(|r| r.as_array()) {
        for r in runs {
            let txt = r.get("text").and_then(|t| t.as_str()).unwrap_or("");
            if txt.contains(':') && txt.chars().all(|c| c.is_ascii_digit() || c == ':') {
                let d = parse_duration_text(txt);
                if d > 0 {
                    duration_secs = Some(d);
                }
            }
            if let Some(bid) = r.pointer("/navigationEndpoint/browseEndpoint/browseId").and_then(|b| b.as_str()) {
                if bid.starts_with("UC") && artist_id.is_none() {
                    artist_id = Some(bid.to_string());
                } else if bid.starts_with("MPREb_") && album_id.is_none() {
                    album_id = Some(bid.to_string());
                }
            }
        }
    }

    if duration_secs.is_none() {
        if let Some(fixed) = resp.get("fixedColumns").and_then(|c| c.as_array()) {
            for fc in fixed {
                let txt = extract_text(fc.pointer("/musicResponsiveListItemFixedColumnRenderer/text"));
                let d = parse_duration_text(&txt);
                if d > 0 {
                    duration_secs = Some(d);
                    break;
                }
            }
        }
    }

    let (kind, id) = if let Some(vid) = video_id {
        ("song".to_string(), vid.to_string())
    } else if let Some(bid) = browse_id {
        (classify_browse_id(bid, &subtitle), bid.to_string())
    } else {
        return None;
    };

    Some(ShelfItem {
        kind,
        id,
        title,
        subtitle,
        thumbnail,
        duration_secs,
        artist_id,
        album_id,
        is_explicit: find_key(resp, "MUSIC_EXPLICIT_BADGE").is_some(),
    })
}

fn collect_responsive_tracks(
    val: &Value,
    out: &mut Vec<Track>,
    fallback_album: Option<&str>,
    fallback_thumb: Option<&str>,
) {
    match val {
        Value::Object(map) => {
            if let Some(resp) = map.get("musicResponsiveListItemRenderer") {
                if let Some(item) = parse_responsive_item(resp) {
                    if item.kind == "song" || item.kind == "video" {
                        let mut track = shelf_item_to_track(&item);
                        if track.album.is_none() {
                            track.album = fallback_album.map(|s| s.to_string());
                        }
                        if track.thumbnail.is_empty() {
                            track.thumbnail = fallback_thumb.unwrap_or("").to_string();
                        }
                        track.set_video_id = resp
                            .pointer("/playlistItemData/playlistSetVideoId")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        out.push(track);
                    }
                }
                return;
            }
            for child in map.values() {
                collect_responsive_tracks(child, out, fallback_album, fallback_thumb);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                collect_responsive_tracks(child, out, fallback_album, fallback_thumb);
            }
        }
        _ => {}
    }
}

fn collect_playlist_panel_tracks(val: &Value, out: &mut Vec<Track>) {
    match val {
        Value::Object(map) => {
            if let Some(item) = map.get("playlistPanelVideoRenderer") {
                if let Some(vid) = item.get("videoId").and_then(|v| v.as_str()) {
                    let title = extract_text(item.get("title"));
                    let artist = extract_text(item.get("longBylineText").or_else(|| item.get("shortBylineText")));
                    let dur_text = extract_text(item.get("lengthText"));
                    let thumbnail = extract_best_thumbnail(item.get("thumbnail"));
                    let clean_artist = artist
                        .split(" • ")
                        .next()
                        .unwrap_or(&artist)
                        .trim()
                        .to_string();
                    let album = artist.split(" • ").nth(1).map(|s| s.trim().to_string());
                    out.push(Track {
                        video_id: vid.to_string(),
                        title,
                        artist: clean_artist,
                        artist_id: None,
                        album,
                        album_id: None,
                        duration_secs: parse_duration_text(&dur_text),
                        thumbnail,
                        is_explicit: find_key(item, "MUSIC_EXPLICIT_BADGE").is_some(),
                        like_status: None,
                        loudness_db: None,
                        local_path: None,
                        is_downloaded: false,
                        codec: None,
                        bitrate_kbps: None,
                        set_video_id: None,
                    });
                }
                return;
            }
            for child in map.values() {
                collect_playlist_panel_tracks(child, out);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                collect_playlist_panel_tracks(child, out);
            }
        }
        _ => {}
    }
}

fn collect_search_suggestions(val: &Value, out: &mut Vec<String>) {
    match val {
        Value::Object(map) => {
            if let Some(sr) = map.get("searchSuggestionRenderer") {
                let text = extract_text(sr.get("suggestion"));
                if !text.is_empty() && !out.contains(&text) {
                    out.push(text);
                }
                return;
            }
            for child in map.values() {
                collect_search_suggestions(child, out);
            }
        }
        Value::Array(arr) => {
            for child in arr {
                collect_search_suggestions(child, out);
            }
        }
        _ => {}
    }
}

fn classify_browse_id(browse_id: &str, subtitle: &str) -> String {
    if browse_id.starts_with("UC") {
        "artist".to_string()
    } else if browse_id.starts_with("MPREb_") || browse_id.starts_with("OLAK5uy_") {
        "album".to_string()
    } else if browse_id.starts_with("VL") || browse_id.starts_with("PL") || browse_id.starts_with("RD") {
        "playlist".to_string()
    } else {
        let lower = subtitle.to_lowercase();
        if lower.starts_with("artist") {
            "artist".to_string()
        } else if lower.starts_with("album") || lower.starts_with("ep") || lower.starts_with("single") {
            "album".to_string()
        } else {
            "playlist".to_string()
        }
    }
}

pub fn shelf_item_to_track(item: &ShelfItem) -> Track {
    let parts: Vec<&str> = item.subtitle.split(" • ").map(|s| s.trim()).collect();
    let filtered: Vec<&str> = parts
        .into_iter()
        .filter(|p| {
            let l = p.to_lowercase();
            l != "song"
                && l != "video"
                && !l.contains("plays")
                && !l.contains("views")
                && !p.chars().all(|c| c.is_ascii_digit() || c == ':')
        })
        .collect();
    let artist = filtered
        .first()
        .copied()
        .unwrap_or("Unknown Artist")
        .to_string();
    let album = filtered.get(1).map(|s| s.to_string());

    Track {
        video_id: item.id.clone(),
        title: item.title.clone(),
        artist,
        artist_id: item.artist_id.clone(),
        album,
        album_id: item.album_id.clone(),
        duration_secs: item.duration_secs.unwrap_or(0),
        thumbnail: item.thumbnail.clone(),
        is_explicit: item.is_explicit,
        like_status: None,
        loudness_db: None,
        local_path: None,
        is_downloaded: false,
        codec: None,
        bitrate_kbps: None,
        set_video_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lrc_and_duration() {
        let lrc = "[00:12.50] First line\n[01:05.25] Second line\n";
        let parsed = parse_lrc(lrc);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].time_ms, 12_500);
        assert_eq!(parsed[0].text, "First line");
        assert_eq!(parsed[1].time_ms, 65_250);
        assert_eq!(parse_duration_text("3:45"), 225);
        assert_eq!(parse_duration_text("1:02:03"), 3723);
    }

    #[test]
    fn test_clean_track_title() {
        assert_eq!(
            clean_track_title("Midnight City (Official Music Video)"),
            "Midnight City"
        );
    }
}
