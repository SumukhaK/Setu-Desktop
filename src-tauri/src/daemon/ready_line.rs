//! Parsing and validating the daemon's single `daemon_ready` stdout line.

use std::net::SocketAddr;
use std::path::PathBuf;

use serde::Deserialize;

use crate::rpc::SetuError;

/// The `daemon_ready` line the daemon prints once its listener is bound.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadyLine {
    pub listen: SocketAddr,
    pub version: String,
    pub token_file: PathBuf,
    pub pid: u32,
}

#[derive(Deserialize)]
struct RawReadyLine {
    event: Option<String>,
    listen: Option<String>,
    version: Option<String>,
    token_file: Option<String>,
    pid: Option<u64>,
}

/// Parse one ready line; reject anything the supervisor must not trust.
pub fn parse(line: &str) -> Result<ReadyLine, SetuError> {
    let raw: RawReadyLine = serde_json::from_str(line).map_err(|_| SetuError::UnexpectedResult)?;
    if raw.event.as_deref() != Some("daemon_ready") {
        return Err(SetuError::UnexpectedResult);
    }
    let listen: SocketAddr = raw
        .listen
        .as_deref()
        .and_then(|listen| listen.parse().ok())
        .ok_or(SetuError::UnexpectedResult)?;
    if !listen.ip().is_loopback() {
        return Err(SetuError::UnexpectedResult);
    }
    let version = raw.version.ok_or(SetuError::UnexpectedResult)?;
    if !version_at_least(&version, (1, 1, 0)) {
        return Err(SetuError::UnexpectedResult);
    }
    let token_file = raw
        .token_file
        .map(PathBuf::from)
        .ok_or(SetuError::UnexpectedResult)?;
    let pid = u32::try_from(raw.pid.ok_or(SetuError::UnexpectedResult)?)
        .map_err(|_| SetuError::UnexpectedResult)?;
    Ok(ReadyLine {
        listen,
        version,
        token_file,
        pid,
    })
}

/// Numeric major.minor.patch comparison; a `-prerelease` suffix is ignored.
fn version_at_least(version: &str, minimum: (u64, u64, u64)) -> bool {
    let core = version.split('-').next().unwrap_or(version);
    let numbers: Option<Vec<u64>> = core.split('.').map(|part| part.parse().ok()).collect();
    match numbers {
        Some(parts) if parts.len() == 3 => (parts[0], parts[1], parts[2]) >= minimum,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready_line(version: &str, listen: &str) -> String {
        serde_json::json!({
            "event": "daemon_ready",
            "listen": listen,
            "version": version,
            "token_file": "C:/state/daemon.token",
            "pid": 4242,
        })
        .to_string()
    }

    #[test]
    fn a_valid_ready_line_parses() {
        let ready = parse(&ready_line("1.1.0", "127.0.0.1:7605")).unwrap();
        assert_eq!(ready.listen, "127.0.0.1:7605".parse().unwrap());
        assert_eq!(ready.version, "1.1.0");
        assert_eq!(ready.token_file, PathBuf::from("C:/state/daemon.token"));
        assert_eq!(ready.pid, 4242);
    }

    #[test]
    fn wrong_event_listen_host_json_and_old_version_are_rejected() {
        let mut wrong_event = serde_json::json!({
            "event": "other", "listen": "127.0.0.1:7605", "version": "1.1.0",
            "token_file": "t", "pid": 1,
        });
        assert!(parse(&wrong_event.to_string()).is_err(), "wrong event");

        assert!(
            parse(&ready_line("1.1.0", "0.0.0.0:1")).is_err(),
            "non-loopback"
        );
        assert!(
            parse(&ready_line("1.1.0", "192.168.1.5:7605")).is_err(),
            "lan address"
        );
        assert!(parse("{not json").is_err(), "malformed json");
        assert!(
            parse(&ready_line("1.0.4", "127.0.0.1:7605")).is_err(),
            "old version"
        );

        wrong_event["pid"] = serde_json::json!("not a number");
        assert!(parse(&wrong_event.to_string()).is_err(), "wrong pid type");
    }

    #[test]
    fn versions_at_or_above_1_1_0_are_accepted_with_prerelease_suffix_ignored() {
        assert!(parse(&ready_line("1.1.0", "127.0.0.1:7605")).is_ok());
        assert!(parse(&ready_line("1.1.0-rc1", "127.0.0.1:7605")).is_ok());
        assert!(parse(&ready_line("1.2.0", "127.0.0.1:7605")).is_ok());
        assert!(parse(&ready_line("2.0.0", "127.0.0.1:7605")).is_ok());
        assert!(
            parse(&ready_line("1.1", "127.0.0.1:7605")).is_err(),
            "two parts"
        );
        assert!(
            parse(&ready_line("x.y.z", "127.0.0.1:7605")).is_err(),
            "not numeric"
        );
    }
}
