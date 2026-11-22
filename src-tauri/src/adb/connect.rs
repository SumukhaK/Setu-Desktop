//! Resolve the local `adb`, run `adb connect` for loopback addresses only, and
//! map its output to a typed outcome.

use std::ffi::OsString;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

const DEFAULT_PORT: u16 = 5037;
const DETAIL_LIMIT: usize = 200;

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum AdbConnectOutcome {
    Connected,
    NotLoopback,
    Missing,
    TimedOut,
    Failed { detail: String },
}

pub fn resolve_adb_path(env_override: Option<OsString>) -> PathBuf {
    match env_override {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => PathBuf::from("adb"),
    }
}

pub fn resolve_adb_server(env_port: Option<String>) -> SocketAddr {
    let port = env_port
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    SocketAddr::from(([127, 0, 0, 1], port))
}

pub fn parse_connect_output(stdout: &str, stderr: &str) -> Result<(), String> {
    let connected = stdout.lines().any(|line| {
        let line = line.trim();
        line.starts_with("connected to ") || line.starts_with("already connected to ")
    });
    if connected {
        return Ok(());
    }

    let detail = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("adb connect failed");
    Err(detail.chars().take(DETAIL_LIMIT).collect())
}

pub async fn adb_connect(adb: &Path, addr: &str, timeout: Duration) -> AdbConnectOutcome {
    let parsed: SocketAddr = match addr.parse() {
        Ok(parsed) => parsed,
        Err(_) => return AdbConnectOutcome::NotLoopback,
    };
    if !parsed.ip().is_loopback() {
        return AdbConnectOutcome::NotLoopback;
    }

    let child = Command::new(adb)
        .arg("connect")
        .arg(addr)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let child = match child {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return AdbConnectOutcome::Missing;
        }
        Err(error) => {
            return AdbConnectOutcome::Failed {
                detail: error.to_string(),
            };
        }
    };

    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return AdbConnectOutcome::Failed {
                detail: error.to_string(),
            };
        }
        Err(_) => return AdbConnectOutcome::TimedOut,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    match parse_connect_output(&stdout, &stderr) {
        Ok(()) => AdbConnectOutcome::Connected,
        Err(detail) => AdbConnectOutcome::Failed { detail },
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::net::SocketAddr;
    use std::path::PathBuf;

    use super::{parse_connect_output, resolve_adb_path, resolve_adb_server};

    #[test]
    fn resolves_adb_from_the_environment_then_path() {
        assert_eq!(resolve_adb_path(None), PathBuf::from("adb"));
        assert_eq!(
            resolve_adb_path(Some(OsString::from(""))),
            PathBuf::from("adb")
        );
        assert_eq!(
            resolve_adb_path(Some(OsString::from("/opt/platform-tools/adb"))),
            PathBuf::from("/opt/platform-tools/adb")
        );
    }

    #[test]
    fn resolves_the_adb_server_port() {
        assert_eq!(
            resolve_adb_server(None),
            SocketAddr::from(([127, 0, 0, 1], 5037))
        );
        assert_eq!(
            resolve_adb_server(Some("5038".to_owned())),
            SocketAddr::from(([127, 0, 0, 1], 5038))
        );
        assert_eq!(
            resolve_adb_server(Some("nope".to_owned())),
            SocketAddr::from(([127, 0, 0, 1], 5037))
        );
        assert_eq!(
            resolve_adb_server(Some("70000".to_owned())),
            SocketAddr::from(([127, 0, 0, 1], 5037))
        );
    }

    #[test]
    fn accepts_connected_and_already_connected_lines() {
        assert_eq!(
            parse_connect_output("connected to 127.0.0.1:41377\n", ""),
            Ok(())
        );
        assert_eq!(
            parse_connect_output("  already connected to 127.0.0.1:41377  \n", ""),
            Ok(())
        );
    }

    #[test]
    fn returns_the_first_stdout_line_as_the_detail() {
        assert_eq!(
            parse_connect_output(
                "failed to connect to 127.0.0.1:41377\nsecond line\n",
                "stderr detail"
            ),
            Err("failed to connect to 127.0.0.1:41377".to_owned())
        );
    }

    #[test]
    fn falls_back_to_stderr_then_a_default() {
        assert_eq!(
            parse_connect_output("\n  \n", "\nerror line\n"),
            Err("error line".to_owned())
        );
        assert_eq!(
            parse_connect_output("", ""),
            Err("adb connect failed".to_owned())
        );
    }

    #[test]
    fn cuts_the_detail_to_two_hundred_characters() {
        let long = "x".repeat(300);
        let detail = parse_connect_output(&long, "").expect_err("not a connected line");
        assert_eq!(detail.chars().count(), 200);
    }
}
