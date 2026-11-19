//! Start flags for `setu-daemon` v1.1.0 (API_SPEC §2 startup flags).

use std::ffi::{OsStr, OsString};
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
        let mut args = vec![
            OsStr::new("--listen").to_owned(),
            OsStr::new("127.0.0.1:0").to_owned(),
            OsStr::new("--state").to_owned(),
            state_dir.as_os_str().to_owned(),
            OsStr::new("--relay").to_owned(),
            OsStr::new(&self.relay).to_owned(),
        ];
        if let Some(label) = &self.label {
            args.extend([
                OsStr::new("--label").to_owned(),
                OsStr::new(label).to_owned(),
            ]);
        }
        if let Some(adb_path) = &self.adb_path {
            args.extend([
                OsStr::new("--adb").to_owned(),
                adb_path.as_os_str().to_owned(),
            ]);
        }
        if let Some(relay_pin) = &self.relay_pin {
            args.extend([
                OsStr::new("--relay-pin").to_owned(),
                OsStr::new(relay_pin).to_owned(),
            ]);
        }
        if let Some(proxy) = &self.proxy {
            args.extend([
                OsStr::new("--proxy").to_owned(),
                OsStr::new(proxy).to_owned(),
            ]);
        }
        if let Some(corporate) = &self.corporate {
            args.extend([
                OsStr::new("--mode").to_owned(),
                OsStr::new("corporate").to_owned(),
                OsStr::new("--identity-file").to_owned(),
                corporate.identity_file.as_os_str().to_owned(),
                OsStr::new("--policy").to_owned(),
                corporate.policy_file.as_os_str().to_owned(),
            ]);
        }
        args
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

    /// Expected argv head for every config: listen, state dir, relay.
    fn expected(tmp: &Path, tail: &[&str]) -> Vec<OsString> {
        let mut args = vec![
            OsStr::new("--listen").to_owned(),
            OsStr::new("127.0.0.1:0").to_owned(),
            OsStr::new("--state").to_owned(),
            tmp.as_os_str().to_owned(),
            OsStr::new("--relay").to_owned(),
            OsStr::new("127.0.0.1:7000").to_owned(),
        ];
        args.extend(tail.iter().map(|value| OsStr::new(*value).to_owned()));
        args
    }

    #[test]
    fn solo_minimal_args_are_listen_state_relay_only() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(config().to_args(tmp.path()), expected(tmp.path(), &[]));
    }

    #[test]
    fn optional_flags_are_appended_in_order() {
        let tmp = tempfile::tempdir().unwrap();
        let mut with_options = config();
        with_options.label = Some("Dev Laptop".into());
        with_options.adb_path = Some(PathBuf::from("C:/platform-tools/adb.exe"));
        with_options.relay_pin = Some("ab12cd34".into());
        with_options.proxy = Some("http://user:pass@proxy.internal:8080".into());
        assert_eq!(
            with_options.to_args(tmp.path()),
            expected(
                tmp.path(),
                &[
                    "--label",
                    "Dev Laptop",
                    "--adb",
                    "C:/platform-tools/adb.exe",
                    "--relay-pin",
                    "ab12cd34",
                    "--proxy",
                    "http://user:pass@proxy.internal:8080",
                ]
            )
        );
    }

    #[test]
    fn corporate_args_add_mode_identity_file_and_policy() {
        let tmp = tempfile::tempdir().unwrap();
        let mut corporate = config();
        corporate.corporate = Some(CorporateFlags {
            identity_file: PathBuf::from("C:/id/identity.jwt"),
            policy_file: PathBuf::from("C:/id/policy.json"),
        });
        assert_eq!(
            corporate.to_args(tmp.path()),
            expected(
                tmp.path(),
                &[
                    "--mode",
                    "corporate",
                    "--identity-file",
                    "C:/id/identity.jwt",
                    "--policy",
                    "C:/id/policy.json",
                ]
            )
        );
    }

    #[test]
    fn args_never_contain_stdio_or_mode_solo() {
        let tmp = tempfile::tempdir().unwrap();
        let mut corporate = config();
        corporate.corporate = Some(CorporateFlags {
            identity_file: PathBuf::from("i"),
            policy_file: PathBuf::from("p"),
        });
        for args in [config().to_args(tmp.path()), corporate.to_args(tmp.path())] {
            assert!(args.iter().all(|a| a.as_os_str() != OsStr::new("--stdio")));
            assert!(!args
                .windows(2)
                .any(|pair| pair[0].as_os_str() == OsStr::new("--mode")
                    && pair[1].as_os_str() == OsStr::new("solo")));
        }
    }
}
