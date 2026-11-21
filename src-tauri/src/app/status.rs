//! Pure mapping from supervisor state to the secret-free status the UI sees.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::daemon::DaemonState;

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AppStatus {
    NotConfigured,
    Starting,
    Ready {
        version: Option<String>,
        attached: bool,
        generation: u64,
    },
    Restarting {
        attempt: u32,
        retry_in_ms: u64,
    },
    Failed {
        reason: String,
    },
    Stopped,
}

pub fn status_of(_state: &DaemonState, _version: Option<String>) -> AppStatus {
    AppStatus::Stopped
}

pub fn resolve_daemon_path(_env_override: Option<OsString>, _exe_dir: &Path) -> PathBuf {
    PathBuf::new()
}

pub fn resolve_relay(
    _runtime: Option<String>,
    _compile_time: Option<&'static str>,
) -> Option<String> {
    None
}
