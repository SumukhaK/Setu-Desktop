//! Resolve the local `adb`, run `adb connect` for loopback addresses only, and
//! map its output to a typed outcome.

use std::ffi::OsString;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum AdbConnectOutcome {
    Connected,
    NotLoopback,
    Missing,
    TimedOut,
    Failed { detail: String },
}

pub fn resolve_adb_path(_env_override: Option<OsString>) -> PathBuf {
    todo!()
}

pub fn resolve_adb_server(_env_port: Option<String>) -> SocketAddr {
    todo!()
}

pub fn parse_connect_output(_stdout: &str, _stderr: &str) -> Result<(), String> {
    todo!()
}

pub async fn adb_connect(_adb: &Path, _addr: &str, _timeout: Duration) -> AdbConnectOutcome {
    todo!()
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
