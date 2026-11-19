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

/// Parse one ready line; reject anything the supervisor must not trust.
pub fn parse(line: &str) -> Result<ReadyLine, SetuError> {
    todo!("parse and validate the ready line")
}

/// Numeric major.minor.patch comparison; a `-prerelease` suffix is ignored.
fn version_at_least(version: &str, minimum: (u64, u64, u64)) -> bool {
    todo!("version comparison")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_valid_ready_line_parses() {
        todo!("red: valid line")
    }

    #[test]
    fn wrong_event_listen_host_json_and_old_version_are_rejected() {
        todo!("red: rejections")
    }

    #[test]
    fn versions_at_or_above_1_1_0_are_accepted_with_prerelease_suffix_ignored() {
        todo!("red: version acceptance")
    }
}
