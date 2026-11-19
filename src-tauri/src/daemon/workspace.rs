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
        todo!("validate the slug")
    }

    /// `<app_data>/setu/solo` or `<app_data>/setu/corp/<org_slug>`.
    ///
    /// The directory itself is created when spawning, not here.
    pub fn state_dir(&self, app_data: &Path) -> PathBuf {
        todo!("workspace state dir")
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
    todo!("read the record")
}

/// Write the attach record atomically: temp file in the same dir, then rename.
pub fn write_attach_record(state_dir: &Path, record: &AttachRecord) -> std::io::Result<()> {
    todo!("write the record")
}

/// Remove the attach record, ignoring a missing file.
pub fn remove_attach_record(state_dir: &Path) {
    todo!("remove the record")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_state_dir_is_setu_solo_under_app_data() {
        todo!("red: solo path")
    }

    #[test]
    fn corporate_state_dir_is_setu_corp_slug_under_app_data() {
        todo!("red: corporate path")
    }

    #[test]
    fn corporate_slugs_outside_the_pattern_are_rejected() {
        todo!("red: slug validation")
    }

    #[test]
    fn attach_record_round_trips_and_holds_no_token() {
        todo!("red: record round trip")
    }

    #[test]
    fn a_malformed_attach_record_reads_as_none() {
        todo!("red: malformed record")
    }
}
