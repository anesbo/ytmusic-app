use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{anyhow, Context, Result};
use tokio::process::Command;

use crate::models::BinaryStatus;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct BinaryManager {
    bin_dir: PathBuf,
    http: reqwest::Client,
}

impl BinaryManager {
    pub fn new(app_data_dir: &Path) -> Result<Self> {
        let bin_dir = app_data_dir.join("bin");
        std::fs::create_dir_all(&bin_dir)?;
        let http = reqwest::Client::builder()
            .user_agent("LiquidYTM/0.1 (Desktop Music Player)")
            .build()?;
        Ok(Self { bin_dir, http })
    }

    pub fn ytdlp_managed_path(&self) -> PathBuf {
        #[cfg(target_os = "windows")]
        let name = "yt-dlp.exe";
        #[cfg(not(target_os = "windows"))]
        let name = "yt-dlp";
        self.bin_dir.join(name)
    }

    pub fn ytdlp_cache_dir(&self) -> PathBuf {
        let dir = self
            .bin_dir
            .parent()
            .unwrap_or(&self.bin_dir)
            .join("ytdlp_cache");
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    pub fn resolve_ytdlp(&self) -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        let name = "yt-dlp.exe";
        #[cfg(not(target_os = "windows"))]
        let name = "yt-dlp";

        // 1. Prefer unpacked --onedir bundle (zero PyInstaller temp-extraction overhead -> ~150ms vs ~4000ms!)
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for cand in [
                    dir.join("bin").join("yt-dlp").join(name),
                    dir.join("bin").join(name),
                    dir.join(name),
                ] {
                    if cand.is_file() {
                        return Some(cand);
                    }
                }
            }
        }
        // 2. Check dev vendor-bin directory in workspace (prefer unpacked --onedir first)
        for cand in [
            PathBuf::from("vendor-bin").join("yt-dlp").join(name),
            PathBuf::from("src-tauri")
                .join("vendor-bin")
                .join("yt-dlp")
                .join(name),
            PathBuf::from("vendor-bin").join(name),
            PathBuf::from("src-tauri").join("vendor-bin").join(name),
        ] {
            if cand.is_file() {
                return Some(cand);
            }
        }
        // 3. Check managed app-data binary
        let managed = self.ytdlp_managed_path();
        if managed.is_file() {
            return Some(managed);
        }
        // 4. Fallback to system PATH
        which_binary("yt-dlp")
    }

    pub fn resolve_ffmpeg(&self) -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        let name = "ffmpeg.exe";
        #[cfg(not(target_os = "windows"))]
        let name = "ffmpeg";

        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for cand in [dir.join("bin").join(name), dir.join(name)] {
                    if cand.is_file() {
                        return Some(cand);
                    }
                }
            }
        }
        for cand in [
            PathBuf::from("vendor-bin").join(name),
            PathBuf::from("src-tauri").join("vendor-bin").join(name),
        ] {
            if cand.is_file() {
                return Some(cand);
            }
        }
        let local = self.bin_dir.join(name);
        if local.is_file() {
            return Some(local);
        }
        which_binary("ffmpeg")
    }

    /// Resolves a JS runtime (`node` or `deno`) for yt-dlp's YouTube EJS challenge solver.
    pub fn resolve_js_runtime(&self) -> Option<String> {
        if let Some(p) = which_binary("node") {
            return Some(format!("node:{}", p.to_string_lossy()));
        }
        #[cfg(target_os = "windows")]
        {
            for cand in [
                r"C:\Program Files\nodejs\node.exe",
                r"C:\Program Files (x86)\nodejs\node.exe",
            ] {
                if Path::new(cand).is_file() {
                    return Some(format!("node:{cand}"));
                }
            }
        }
        if let Some(p) = which_binary("deno") {
            return Some(format!("deno:{}", p.to_string_lossy()));
        }
        None
    }

    pub async fn status(&self) -> BinaryStatus {
        let ytdlp_path = self.resolve_ytdlp();
        let ffmpeg_path = self.resolve_ffmpeg();

        let ytdlp_version = match &ytdlp_path {
            Some(p) => read_command_first_line(p, &["--version"]).await.ok(),
            None => None,
        };
        let ffmpeg_version = match &ffmpeg_path {
            Some(p) => read_command_first_line(p, &["-version"])
                .await
                .ok()
                .map(|line| {
                    line.split_whitespace()
                        .take(3)
                        .collect::<Vec<_>>()
                        .join(" ")
                }),
            None => None,
        };

        BinaryStatus {
            ytdlp_installed: ytdlp_path.is_some(),
            ytdlp_path: ytdlp_path.map(|p| p.to_string_lossy().to_string()),
            ytdlp_version,
            ffmpeg_installed: ffmpeg_path.is_some(),
            ffmpeg_path: ffmpeg_path.map(|p| p.to_string_lossy().to_string()),
            ffmpeg_version,
        }
    }

    pub async fn ensure_ytdlp(&self) -> Result<PathBuf> {
        if let Some(p) = self.resolve_ytdlp() {
            return Ok(p);
        }
        self.download_ytdlp().await
    }

    pub async fn download_ytdlp(&self) -> Result<PathBuf> {
        #[cfg(target_os = "windows")]
        let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
        #[cfg(target_os = "macos")]
        let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
        #[cfg(all(unix, not(target_os = "macos")))]
        let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

        let resp = self
            .http
            .get(url)
            .send()
            .await
            .context("Failed to connect to GitHub releases for yt-dlp")?
            .error_for_status()
            .context("Failed to download yt-dlp binary")?;

        let bytes = resp.bytes().await?;
        if bytes.len() < 100_000 {
            return Err(anyhow!("Downloaded yt-dlp binary looks invalid/truncated"));
        }

        let target = self.ytdlp_managed_path();
        let tmp = target.with_extension("download");
        tokio::fs::write(&tmp, &bytes).await?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&tmp)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&tmp, perms)?;
        }

        tokio::fs::rename(&tmp, &target).await?;
        Ok(target)
    }

    pub async fn update_ytdlp(&self) -> Result<String> {
        let managed = self.ytdlp_managed_path();
        if !managed.exists() {
            let path = self.download_ytdlp().await?;
            let ver = read_command_first_line(&path, &["--version"])
                .await
                .unwrap_or_else(|_| "installed".into());
            return Ok(format!("Downloaded yt-dlp ({ver})"));
        }

        let mut cmd = hidden_command(&managed);
        cmd.arg("-U")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = cmd.output().await.context("Failed to run yt-dlp -U")?;
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(text.trim().to_string())
    }
}

pub fn hidden_command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Forcefully kills a process AND its entire child process tree (e.g., PyInstaller child yt-dlp + node.exe)
/// so cancelled track switches never leave zombie CPU/disk-hogging processes running on Windows.
pub fn kill_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

async fn read_command_first_line(program: &Path, args: &[&str]) -> Result<String> {
    let mut cmd = hidden_command(program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let output = cmd.output().await?;
    if !output.status.success() {
        return Err(anyhow!("Command failed"));
    }
    let s = String::from_utf8_lossy(&output.stdout);
    Ok(s.lines().next().unwrap_or("").trim().to_string())
}

fn which_binary(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    #[cfg(target_os = "windows")]
    let candidates = [format!("{name}.exe"), name.to_string()];
    #[cfg(not(target_os = "windows"))]
    let candidates = [name.to_string()];

    for dir in std::env::split_paths(&path_var) {
        for cand in &candidates {
            let full = dir.join(cand);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}
