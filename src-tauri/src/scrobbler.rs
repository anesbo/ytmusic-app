use std::collections::{BTreeMap, HashMap};
use std::sync::RwLock;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::logger;
use crate::models::{AppSettings, Track};

/// Native Last.fm + ListenBrainz Scrobbler & Live Lyrics Translator (zero extra crate dependencies).
pub struct ScrobblerAndTranslate {
    http: reqwest::Client,
    translation_cache: RwLock<HashMap<String, Vec<String>>>,
}

impl ScrobblerAndTranslate {
    pub fn new() -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent("LiquidYTM/0.1 (Desktop Music Player)")
            .timeout(Duration::from_secs(10))
            .build()?;
        Ok(Self {
            http,
            translation_cache: RwLock::new(HashMap::new()),
        })
    }

    pub async fn submit_now_playing(&self, settings: &AppSettings, track: &Track) {
        if !settings.scrobble_enabled {
            return;
        }
        if !settings.listenbrainz_token.trim().is_empty() {
            let _ = self
                .listenbrainz_submit(&settings.listenbrainz_token, track, true)
                .await;
        }
        if !settings.lastfm_api_key.trim().is_empty()
            && !settings.lastfm_api_secret.trim().is_empty()
            && !settings.lastfm_session_key.trim().is_empty()
        {
            let _ = self.lastfm_submit(settings, track, true).await;
        }
    }

    pub async fn submit_scrobble(&self, settings: &AppSettings, track: &Track) {
        if !settings.scrobble_enabled {
            return;
        }
        if !settings.listenbrainz_token.trim().is_empty() {
            if let Err(e) = self
                .listenbrainz_submit(&settings.listenbrainz_token, track, false)
                .await
            {
                logger::warn("scrobble", format!("ListenBrainz scrobble failed: {e}"));
            } else {
                logger::info("scrobble", format!("Scrobbled '{}' to ListenBrainz", track.title));
            }
        }
        if !settings.lastfm_api_key.trim().is_empty()
            && !settings.lastfm_api_secret.trim().is_empty()
            && !settings.lastfm_session_key.trim().is_empty()
        {
            if let Err(e) = self.lastfm_submit(settings, track, false).await {
                logger::warn("scrobble", format!("Last.fm scrobble failed: {e}"));
            } else {
                logger::info("scrobble", format!("Scrobbled '{}' to Last.fm", track.title));
            }
        }
    }

    async fn listenbrainz_submit(&self, token: &str, track: &Track, now_playing: bool) -> Result<()> {
        let mut meta = json!({
            "artist_name": track.artist,
            "track_name": track.title,
        });
        if let Some(alb) = &track.album {
            if !alb.is_empty() {
                meta["release_name"] = json!(alb);
            }
        }
        let payload = if now_playing {
            json!({
                "listen_type": "playing_now",
                "payload": [{ "track_metadata": meta }]
            })
        } else {
            json!({
                "listen_type": "single",
                "payload": [{
                    "listened_at": chrono::Utc::now().timestamp(),
                    "track_metadata": meta
                }]
            })
        };
        let resp = self
            .http
            .post("https://api.listenbrainz.org/1/submit-listens")
            .header("Authorization", format!("Token {}", token.trim()))
            .json(&payload)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(anyhow!("ListenBrainz HTTP {}", resp.status()));
        }
        Ok(())
    }

    async fn lastfm_submit(&self, settings: &AppSettings, track: &Track, now_playing: bool) -> Result<()> {
        let mut params = BTreeMap::<String, String>::new();
        params.insert(
            "method".to_string(),
            if now_playing {
                "track.updateNowPlaying".to_string()
            } else {
                "track.scrobble".to_string()
            },
        );
        params.insert("api_key".to_string(), settings.lastfm_api_key.trim().to_string());
        params.insert("sk".to_string(), settings.lastfm_session_key.trim().to_string());
        params.insert("artist".to_string(), track.artist.clone());
        params.insert("track".to_string(), track.title.clone());
        if let Some(alb) = &track.album {
            if !alb.is_empty() {
                params.insert("album".to_string(), alb.clone());
            }
        }
        if !now_playing {
            params.insert("timestamp".to_string(), chrono::Utc::now().timestamp().to_string());
        }

        let mut sig_src = String::new();
        for (k, v) in &params {
            sig_src.push_str(k);
            sig_src.push_str(v);
        }
        sig_src.push_str(settings.lastfm_api_secret.trim());
        let api_sig = md5_hex(sig_src.as_bytes());
        params.insert("api_sig".to_string(), api_sig);
        params.insert("format".to_string(), "json".to_string());

        let resp = self
            .http
            .post("https://ws.audioscrobbler.com/2.0/")
            .form(&params)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(anyhow!("Last.fm HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// Translates lyric lines into `target_lang` (e.g. "en", "fr", "ar", "es", "ja") with caching.
    pub async fn translate_lines(
        &self,
        cache_key: &str,
        lines: &[String],
        target_lang: &str,
    ) -> Result<Vec<String>> {
        let full_key = format!("{cache_key}:{target_lang}");
        if let Some(hit) = self.translation_cache.read().unwrap().get(&full_key) {
            return Ok(hit.clone());
        }
        if lines.is_empty() {
            return Ok(Vec::new());
        }

        // Batch lines in chunks of 30 separated by newline so a full song takes 1-2 fast HTTP requests
        let mut translated = Vec::with_capacity(lines.len());
        for chunk in lines.chunks(30) {
            let joined = chunk
                .iter()
                .map(|l| if l.trim().is_empty() { "♪" } else { l.trim() })
                .collect::<Vec<_>>()
                .join("\n");

            let resp = self
                .http
                .get("https://translate.googleapis.com/translate_a/single")
                .query(&[
                    ("client", "gtx"),
                    ("sl", "auto"),
                    ("tl", target_lang),
                    ("dt", "t"),
                    ("q", joined.as_str()),
                ])
                .send()
                .await?;

            if !resp.status().is_success() {
                return Err(anyhow!("Translation service HTTP {}", resp.status()));
            }
            let val: Value = resp.json().await?;
            let mut combined = String::new();
            if let Some(arr) = val.get(0).and_then(|v| v.as_array()) {
                for seg in arr {
                    if let Some(part) = seg.get(0).and_then(|v| v.as_str()) {
                        combined.push_str(part);
                    }
                }
            }
            let mut out_lines: Vec<String> = combined.split('\n').map(|s| s.trim().to_string()).collect();
            while out_lines.len() < chunk.len() {
                out_lines.push(String::new());
            }
            out_lines.truncate(chunk.len());
            translated.extend(out_lines);
        }

        self.translation_cache
            .write()
            .unwrap()
            .insert(full_key, translated.clone());
        Ok(translated)
    }
}

/// Pure-Rust RFC 1321 MD5 hex digest for Last.fm API signature generation (zero external crates).
fn md5_hex(input: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20,
        5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    let mut msg = input.to_vec();
    let bit_len = (msg.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());

    let mut a0: u32 = 0x67452301;
    let mut b0: u32 = 0xefcdab89;
    let mut c0: u32 = 0x98badcfe;
    let mut d0: u32 = 0x10325476;

    for chunk in msg.chunks_exact(64) {
        let mut m = [0u32; 16];
        for (i, w) in m.iter_mut().enumerate() {
            *w = u32::from_le_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i {
                0..=15 => ((b & c) | ((!b) & d), i),
                16..=31 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | (!d)), (7 * i) % 16),
            };
            let temp = d;
            d = c;
            c = b;
            b = b.wrapping_add(
                a.wrapping_add(f)
                    .wrapping_add(K[i])
                    .wrapping_add(m[g])
                    .rotate_left(S[i]),
            );
            a = temp;
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    let mut digest = [0u8; 16];
    digest[0..4].copy_from_slice(&a0.to_le_bytes());
    digest[4..8].copy_from_slice(&b0.to_le_bytes());
    digest[8..12].copy_from_slice(&c0.to_le_bytes());
    digest[12..16].copy_from_slice(&d0.to_le_bytes());
    hex::encode(digest)
}
