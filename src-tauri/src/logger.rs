use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Local;
use serde::{Deserialize, Serialize};

const MAX_LOG_ENTRIES: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub scope: String,
    pub message: String,
}

struct LoggerInner {
    entries: VecDeque<LogEntry>,
    log_file: Option<PathBuf>,
}

static LOGGER: OnceLock<Mutex<LoggerInner>> = OnceLock::new();

fn get_logger() -> &'static Mutex<LoggerInner> {
    LOGGER.get_or_init(|| {
        Mutex::new(LoggerInner {
            entries: VecDeque::with_capacity(MAX_LOG_ENTRIES),
            log_file: None,
        })
    })
}

pub fn init(app_data_dir: &Path) {
    let logs_dir = app_data_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let file_path = logs_dir.join("liquidytm.log");
    {
        let mut guard = get_logger().lock().unwrap();
        guard.log_file = Some(file_path.clone());
    }
    info("app", format!("LiquidYTM started — log file: {}", file_path.display()));
}

pub fn log(level: &str, scope: &str, message: impl Into<String>) {
    let msg = message.into();
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
    let entry = LogEntry {
        timestamp: ts.clone(),
        level: level.to_uppercase(),
        scope: scope.to_string(),
        message: msg.clone(),
    };

    let mut guard = get_logger().lock().unwrap();
    if guard.entries.len() >= MAX_LOG_ENTRIES {
        guard.entries.pop_front();
    }
    guard.entries.push_back(entry);

    if let Some(path) = &guard.log_file {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "[{ts}] [{}] [{scope}] {msg}", level.to_uppercase());
        }
    }
}

pub fn info(scope: &str, msg: impl Into<String>) {
    log("INFO", scope, msg);
}

pub fn warn(scope: &str, msg: impl Into<String>) {
    log("WARN", scope, msg);
}

pub fn error(scope: &str, msg: impl Into<String>) {
    log("ERROR", scope, msg);
}

pub fn get_entries() -> Vec<LogEntry> {
    let guard = get_logger().lock().unwrap();
    guard.entries.iter().cloned().collect()
}

pub fn clear() {
    let mut guard = get_logger().lock().unwrap();
    guard.entries.clear();
    if let Some(path) = &guard.log_file {
        let _ = std::fs::write(path, "");
    }
}

pub fn format_plain_text(header_summary: &str) -> String {
    let entries = get_entries();
    let mut out = String::new();
    out.push_str("=== LiquidYTM Diagnostic Log Report ===\n");
    out.push_str(header_summary);
    out.push_str("\n=== Events ===\n");
    for e in entries {
        out.push_str(&format!(
            "[{}] [{}] [{}] {}\n",
            e.timestamp, e.level, e.scope, e.message
        ));
    }
    out
}

pub fn log_file_path() -> Option<PathBuf> {
    get_logger().lock().unwrap().log_file.clone()
}
