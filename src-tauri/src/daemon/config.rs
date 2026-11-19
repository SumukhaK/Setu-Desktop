//! Start flags for `setu-daemon` v1.1.0 (API_SPEC §2 startup flags).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Corporate-mode flags: the identity file and the policy file.
#[derive(Clone)]
pub struct CorporateFlags {
    pub identity_file: PathBuf,
    pub policy_file: PathBuf,
}

/// How the supervisor starts `setu-daemon`.
///
/// No `Debug` on purpose: the proxy URL can carry credentials (AD-5).
#[derive(Clone)]
pub struct DaemonConfig {
    pub daemon_path: PathBuf,
    pub relay: String,
    pub label: Option<String>,
    pub adb_path: Option<PathBuf>,
    pub relay_pin: Option<String>,
    pub proxy: Option<String>,
    pub corporate: Option<CorporateFlags>,
}

impl DaemonConfig {
    /// The daemon argv, in order: `--listen 127.0.0.1:0 --state <dir> --relay <url>`,
    /// then the optional flags. Never `--stdio`; never `--mode solo`.
    pub fn to_args(&self, state_dir: &Path) -> Vec<OsString> {
        todo!("build the argv")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> DaemonConfig {
        DaemonConfig {
            daemon_path: PathBuf::from("setu-daemon"),
            relay: "127.0.0.1:7000".into(),
            label: None,
            adb_path: None,
            relay_pin: None,
            proxy: None,
            corporate: None,
        }
    }

    #[test]
    fn solo_minimal_args_are_listen_state_relay_only() {
        todo!("red: minimal argv")
    }

    #[test]
    fn optional_flags_are_appended_in_order() {
        todo!("red: label, adb, relay-pin, proxy")
    }

    #[test]
    fn corporate_args_add_mode_identity_file_and_policy() {
        todo!("red: corporate argv")
    }

    #[test]
    fn args_never_contain_stdio_or_mode_solo() {
        todo!("red: forbidden flags")
    }
}
