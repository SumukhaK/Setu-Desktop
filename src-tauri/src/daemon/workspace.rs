//! Workspace identity, state directory layout and the attach record (AD-7).

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::rpc::SetuError;

/// Which workspace a supervisor runs a daemon for.
#[derive(Debug, Clone, PartialEq)]
pub enum Workspace {
    Solo,
    Corporate { org_slug: String },
}

impl Workspace {
    /// Accept a corporate workspace slug: `[a-z0-9-]{1,63}`, not starting with `-`.
    pub fn corporate(slug: &str) -> Result<Workspace, SetuError> {
        let valid = !slug.is_empty()
            && slug.len() <= 63
            && !slug.starts_with('-')
            && slug
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if valid {
            Ok(Self::Corporate {
                org_slug: slug.to_owned(),
            })
        } else {
            Err(SetuError::UnexpectedResult)
        }
    }

    /// `<app_data>/setu/solo` or `<app_data>/setu/corp/<org_slug>`.
    ///
    /// The directory itself is created when spawning, not here.
    pub fn state_dir(&self, app_data: &Path) -> PathBuf {
        match self {
            Self::Solo => app_data.join("setu").join("solo"),
            Self::Corporate { org_slug } => app_data.join("setu").join("corp").join(org_slug),
        }
    }
}

/// The live-daemon record in `<state_dir>/desktop-daemon.json` (AD-7).
/// It never contains the token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttachRecord {
    pub listen: SocketAddr,
    pub pid: u32,
    pub version: String,
}

/// Path of the attach record inside a state directory.
pub fn attach_record_path(state_dir: &Path) -> PathBuf {
    state_dir.join("desktop-daemon.json")
}

/// Read the attach record; a missing or malformed file reads as `None`.
pub fn read_attach_record(state_dir: &Path) -> Option<AttachRecord> {
    let text = std::fs::read_to_string(attach_record_path(state_dir)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write the attach record atomically: temp file in the same dir, then rename
/// (`MoveFileEx(MOVEFILE_REPLACE_EXISTING)` on Windows, `rename` on Unix).
pub fn write_attach_record(state_dir: &Path, record: &AttachRecord) -> std::io::Result<()> {
    let temp_path = state_dir.join("desktop-daemon.json.tmp");
    let mut file = std::fs::File::create(&temp_path)?;
    serde_json::to_writer_pretty(&mut file, record).map_err(std::io::Error::other)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&temp_path, attach_record_path(state_dir))?;
    Ok(())
}

/// Remove the attach record, ignoring a missing file.
pub fn remove_attach_record(state_dir: &Path) {
    let _ = std::fs::remove_file(attach_record_path(state_dir));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_state_dir_is_setu_solo_under_app_data() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            Workspace::Solo.state_dir(tmp.path()),
            tmp.path().join("setu").join("solo")
        );
    }

    #[test]
    fn corporate_state_dir_is_setu_corp_slug_under_app_data() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = Workspace::corporate("acme").unwrap();
        assert_eq!(
            workspace,
            Workspace::Corporate {
                org_slug: "acme".into()
            }
        );
        assert_eq!(
            workspace.state_dir(tmp.path()),
            tmp.path().join("setu").join("corp").join("acme")
        );
    }

    #[test]
    fn corporate_slugs_outside_the_pattern_are_rejected() {
        for slug in ["", "../x", "Acme", "a/b", "-lead"] {
            assert!(
                Workspace::corporate(slug).is_err(),
                "slug {slug:?} was accepted"
            );
        }
        assert!(
            Workspace::corporate(&"a".repeat(64)).is_err(),
            "64 chars accepted"
        );
    }

    #[test]
    fn attach_record_round_trips_and_holds_no_token() {
        let tmp = tempfile::tempdir().unwrap();
        let state_dir = tmp.path().join("state");
        std::fs::create_dir_all(&state_dir).unwrap();
        let record = AttachRecord {
            listen: "127.0.0.1:1234".parse().unwrap(),
            pid: 7,
            version: "1.1.0".into(),
        };
        write_attach_record(&state_dir, &record).unwrap();
        assert_eq!(read_attach_record(&state_dir), Some(record));
        let text = std::fs::read_to_string(attach_record_path(&state_dir)).unwrap();
        assert!(!text.contains("token"), "record must not contain the token");
    }

    #[test]
    fn a_malformed_attach_record_reads_as_none() {
        let tmp = tempfile::tempdir().unwrap();
        let state_dir = tmp.path().join("state");
        std::fs::create_dir_all(&state_dir).unwrap();
        assert!(read_attach_record(&state_dir).is_none(), "missing file");
        std::fs::write(attach_record_path(&state_dir), "not json").unwrap();
        assert!(read_attach_record(&state_dir).is_none(), "not json");
        std::fs::write(attach_record_path(&state_dir), r#"{"listen": 5}"#).unwrap();
        assert!(
            read_attach_record(&state_dir).is_none(),
            "wrong field types"
        );
    }
}
