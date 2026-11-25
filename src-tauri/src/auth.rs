use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use anyhow::{anyhow, Context, Result};
use sha1::{Digest, Sha1};

use crate::models::AccountInfo;

const KEYRING_SERVICE: &str = "com.liquidytm.app";
const KEYRING_USER: &str = "ytmusic_cookies_v1";
const YTM_ORIGIN: &str = "https://music.youtube.com";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StoredCookie {
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub expires: i64,
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct AuthSession {
    pub cookies: Vec<StoredCookie>,
    pub auth_source: String,
    pub account_name: Option<String>,
    pub account_handle: Option<String>,
    pub avatar_url: Option<String>,
    pub is_premium: bool,
}

pub struct AuthManager {
    session: RwLock<AuthSession>,
    fallback_path: PathBuf,
    ytdlp_cookie_path: PathBuf,
}

impl AuthManager {
    pub fn new(app_data_dir: &Path) -> Result<Self> {
        let auth_dir = app_data_dir.join("auth");
        std::fs::create_dir_all(&auth_dir)?;
        let fallback_path = auth_dir.join("session.json");
        let ytdlp_cookie_path = auth_dir.join("cookies.txt");

        let loaded = Self::load_session(&fallback_path).unwrap_or_default();
        let mgr = Self {
            session: RwLock::new(loaded),
            fallback_path,
            ytdlp_cookie_path,
        };
        let _ = mgr.write_netscape_cookies_file();
        Ok(mgr)
    }

    fn load_session(fallback_path: &Path) -> Option<AuthSession> {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            if let Ok(secret) = entry.get_password() {
                if let Ok(sess) = serde_json::from_str::<AuthSession>(&secret) {
                    if !sess.cookies.is_empty() {
                        return Some(sess);
                    }
                }
            }
        }
        if fallback_path.exists() {
            if let Ok(text) = std::fs::read_to_string(fallback_path) {
                if let Ok(sess) = serde_json::from_str::<AuthSession>(&text) {
                    return Some(sess);
                }
            }
        }
        None
    }

    fn persist_session(&self, sess: &AuthSession) -> Result<()> {
        let json = serde_json::to_string(sess)?;
        let saved_keyring = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .and_then(|entry| entry.set_password(&json))
            .is_ok();
        if !saved_keyring {
            std::fs::write(&self.fallback_path, &json)?;
        } else if self.fallback_path.exists() {
            let _ = std::fs::remove_file(&self.fallback_path);
        }
        Ok(())
    }

    pub fn set_cookies(&self, cookies: Vec<StoredCookie>, source: &str) -> Result<()> {
        let has_auth = cookies.iter().any(|c| {
            matches!(
                c.name.as_str(),
                "SAPISID" | "__Secure-3PAPISID" | "SID" | "__Secure-3PSID"
            )
        });
        if !has_auth {
            return Err(anyhow!(
                "No YouTube Music authentication cookies found (SAPISID / SID missing). Make sure you finished signing in."
            ));
        }

        let sess = AuthSession {
            cookies,
            auth_source: source.to_string(),
            account_name: None,
            account_handle: None,
            avatar_url: None,
            is_premium: false,
        };
        self.persist_session(&sess)?;
        *self.session.write().unwrap() = sess;
        self.write_netscape_cookies_file()?;
        Ok(())
    }

    pub fn import_netscape_cookies(&self, content: &str) -> Result<usize> {
        let parsed = parse_netscape_cookies(content);
        if parsed.is_empty() {
            return Err(anyhow!(
                "No YouTube/Google cookies found in the provided cookies.txt content"
            ));
        }
        let count = parsed.len();
        self.set_cookies(parsed, "cookies_file")?;
        Ok(count)
    }

    pub fn import_raw_cookie_header(&self, header: &str) -> Result<usize> {
        let mut cookies = Vec::new();
        for part in header.split(';') {
            let trimmed = part.trim();
            if let Some((k, v)) = trimmed.split_once('=') {
                let name = k.trim();
                let value = v.trim();
                if !name.is_empty() && !value.is_empty() {
                    cookies.push(StoredCookie {
                        domain: ".youtube.com".to_string(),
                        path: "/".to_string(),
                        secure: true,
                        expires: chrono::Utc::now().timestamp() + 86400 * 365,
                        name: name.to_string(),
                        value: value.to_string(),
                    });
                }
            }
        }
        let count = cookies.len();
        self.set_cookies(cookies, "cookies_file")?;
        Ok(count)
    }

    pub fn update_profile(
        &self,
        name: Option<String>,
        handle: Option<String>,
        avatar_url: Option<String>,
        is_premium: bool,
    ) {
        let mut guard = self.session.write().unwrap();
        guard.account_name = name;
        guard.account_handle = handle;
        guard.avatar_url = avatar_url;
        guard.is_premium = is_premium;
        let _ = self.persist_session(&guard);
    }

    pub fn logout(&self) -> Result<()> {
        *self.session.write().unwrap() = AuthSession::default();
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            let _ = entry.delete_credential();
        }
        if self.fallback_path.exists() {
            let _ = std::fs::remove_file(&self.fallback_path);
        }
        if self.ytdlp_cookie_path.exists() {
            let _ = std::fs::remove_file(&self.ytdlp_cookie_path);
        }
        Ok(())
    }

    pub fn is_logged_in(&self) -> bool {
        let guard = self.session.read().unwrap();
        !guard.cookies.is_empty() && Self::extract_sapisid(&guard.cookies).is_some()
    }

    pub fn account_info(&self) -> AccountInfo {
        let guard = self.session.read().unwrap();
        let logged_in = !guard.cookies.is_empty() && Self::extract_sapisid(&guard.cookies).is_some();
        AccountInfo {
            logged_in,
            name: guard.account_name.clone(),
            handle: guard.account_handle.clone(),
            avatar_url: guard.avatar_url.clone(),
            is_premium: guard.is_premium,
            auth_source: if logged_in {
                if guard.auth_source.is_empty() {
                    "webview".to_string()
                } else {
                    guard.auth_source.clone()
                }
            } else {
                "none".to_string()
            },
        }
    }

    pub fn cookie_header(&self) -> Option<String> {
        let guard = self.session.read().unwrap();
        if guard.cookies.is_empty() {
            return None;
        }
        // Only send youtube.com cookies so google.com/accounts.google.com cookies never overwrite YT SAPISID/SID
        let mut dedup: HashMap<&str, &str> = HashMap::new();
        for c in &guard.cookies {
            if c.domain.is_empty() || c.domain.contains("youtube.com") {
                dedup.insert(c.name.as_str(), c.value.as_str());
            }
        }
        if dedup.is_empty() {
            for c in &guard.cookies {
                dedup.insert(c.name.as_str(), c.value.as_str());
            }
        }
        let header = dedup
            .into_iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        Some(header)
    }

    pub fn sapisidhash_header(&self) -> Option<String> {
        let guard = self.session.read().unwrap();
        let sapisid = Self::extract_sapisid(&guard.cookies)?;
        let ts = chrono::Utc::now().timestamp();
        Some(build_sapisidhash(ts, &sapisid, YTM_ORIGIN))
    }

    pub fn ytdlp_cookies_file(&self) -> Option<PathBuf> {
        if self.is_logged_in() && self.ytdlp_cookie_path.exists() {
            Some(self.ytdlp_cookie_path.clone())
        } else {
            None
        }
    }

    fn write_netscape_cookies_file(&self) -> Result<()> {
        let guard = self.session.read().unwrap();
        if guard.cookies.is_empty() {
            if self.ytdlp_cookie_path.exists() {
                let _ = std::fs::remove_file(&self.ytdlp_cookie_path);
            }
            return Ok(());
        }
        let mut out = String::from("# Netscape HTTP Cookie File\n");
        for c in &guard.cookies {
            if !c.domain.is_empty() && !c.domain.contains("youtube.com") {
                continue;
            }
            let domain = if c.domain.is_empty() {
                ".youtube.com"
            } else {
                c.domain.as_str()
            };
            let include_subdomains = if domain.starts_with('.') { "TRUE" } else { "FALSE" };
            let path = if c.path.is_empty() { "/" } else { c.path.as_str() };
            let secure = if c.secure { "TRUE" } else { "FALSE" };
            let exp = if c.expires > 0 {
                c.expires
            } else {
                chrono::Utc::now().timestamp() + 86400 * 365
            };
            out.push_str(&format!(
                "{domain}\t{include_subdomains}\t{path}\t{secure}\t{exp}\t{}\t{}\n",
                c.name, c.value
            ));
        }
        std::fs::write(&self.ytdlp_cookie_path, out)
            .context("Failed to write Netscape cookies file for yt-dlp")?;
        Ok(())
    }

    fn extract_sapisid(cookies: &[StoredCookie]) -> Option<String> {
        // Strictly prefer youtube.com SAPISID over google.com SAPISID
        let yt_cookies: Vec<&StoredCookie> = cookies
            .iter()
            .filter(|c| c.domain.is_empty() || c.domain.contains("youtube.com"))
            .collect();
        let pool = if yt_cookies.is_empty() {
            cookies.iter().collect::<Vec<_>>()
        } else {
            yt_cookies
        };
        pool.iter()
            .find(|c| c.name == "SAPISID")
            .or_else(|| pool.iter().find(|c| c.name == "__Secure-3PAPISID"))
            .map(|c| c.value.clone())
    }
}

pub fn build_sapisidhash(timestamp: i64, sapisid: &str, origin: &str) -> String {
    let payload = format!("{timestamp} {sapisid} {origin}");
    let mut hasher = Sha1::new();
    hasher.update(payload.as_bytes());
    let digest = hex::encode(hasher.finalize());
    format!("SAPISIDHASH {timestamp}_{digest}")
}

pub fn parse_netscape_cookies(content: &str) -> Vec<StoredCookie> {
    let mut out = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || (trimmed.starts_with('#') && !trimmed.starts_with("#HttpOnly_")) {
            continue;
        }
        let clean = trimmed.strip_prefix("#HttpOnly_").unwrap_or(trimmed);
        let parts: Vec<&str> = clean.split('\t').collect();
        if parts.len() < 7 {
            continue;
        }
        let domain = parts[0].trim();
        if !domain.contains("youtube.com") && !domain.contains("google.com") {
            continue;
        }
        let path = parts[2].trim();
        let secure = parts[3].eq_ignore_ascii_case("TRUE");
        let expires = parts[4].trim().parse::<i64>().unwrap_or(0);
        let name = parts[5].trim();
        let value = parts[6].trim();
        if !name.is_empty() {
            out.push(StoredCookie {
                domain: domain.to_string(),
                path: path.to_string(),
                secure,
                expires,
                name: name.to_string(),
                value: value.to_string(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sapisidhash_deterministic() {
        let h = build_sapisidhash(1700000000, "test_sapisid_value", "https://music.youtube.com");
        assert!(h.starts_with("SAPISIDHASH 1700000000_"));
        assert_eq!(h.len(), "SAPISIDHASH 1700000000_".len() + 40);
    }

    #[test]
    fn test_parse_netscape_cookies() {
        let sample = "\
# Netscape HTTP Cookie File
.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSAPISID\tabc123/xyz
#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1999999999\t__Secure-3PSID\tsecret
.example.com\tTRUE\t/\tFALSE\t1999999999\tOTHER\tignored
";
        let cookies = parse_netscape_cookies(sample);
        assert_eq!(cookies.len(), 2);
        assert_eq!(cookies[0].name, "SAPISID");
        assert_eq!(cookies[1].name, "__Secure-3PSID");
    }
}
