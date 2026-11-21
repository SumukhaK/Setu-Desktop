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

pub fn status_of(state: &DaemonState, version: Option<String>) -> AppStatus {
    match state {
        DaemonState::Starting => AppStatus::Starting,
        DaemonState::Ready {
            generation,
            attached,
            ..
        } => AppStatus::Ready {
            version,
            attached: *attached,
            generation: *generation,
        },
        DaemonState::Restarting { attempt, retry_in } => AppStatus::Restarting {
            attempt: *attempt,
            retry_in_ms: u64::try_from(retry_in.as_millis()).unwrap_or(u64::MAX),
        },
        DaemonState::Failed { reason } => AppStatus::Failed {
            reason: reason.clone(),
        },
        DaemonState::Stopped => AppStatus::Stopped,
    }
}

pub fn resolve_daemon_path(env_override: Option<OsString>, exe_dir: &Path) -> PathBuf {
    env_override
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| exe_dir.join(format!("setu-daemon{}", std::env::consts::EXE_SUFFIX)))
}

pub fn resolve_relay(
    runtime: Option<String>,
    compile_time: Option<&'static str>,
) -> Option<String> {
    runtime
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            compile_time
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use super::*;

    #[test]
    fn starting_maps_to_starting() {
        assert_eq!(status_of(&DaemonState::Starting, None), AppStatus::Starting);
    }

    #[test]
    fn restarting_converts_the_delay_to_milliseconds() {
        let state = DaemonState::Restarting {
            attempt: 3,
            retry_in: Duration::from_millis(2500),
        };
        assert_eq!(
            status_of(&state, None),
            AppStatus::Restarting {
                attempt: 3,
                retry_in_ms: 2500,
            }
        );
    }

    #[test]
    fn failed_keeps_the_reason_and_stopped_maps_to_stopped() {
        let failed = DaemonState::Failed {
            reason: "daemon exited".into(),
        };
        assert_eq!(
            status_of(&failed, None),
            AppStatus::Failed {
                reason: "daemon exited".into(),
            }
        );
        assert_eq!(status_of(&DaemonState::Stopped, None), AppStatus::Stopped);
    }

    #[test]
    fn ready_json_uses_the_field_names_the_ui_reads() {
        let ready = AppStatus::Ready {
            version: Some("1.1.0".into()),
            attached: true,
            generation: 4,
        };
        assert_eq!(
            serde_json::to_value(ready).unwrap(),
            json!({
                "state": "ready",
                "version": "1.1.0",
                "attached": true,
                "generation": 4,
            })
        );

        let no_version = AppStatus::Ready {
            version: None,
            attached: false,
            generation: 1,
        };
        assert_eq!(
            serde_json::to_value(no_version).unwrap(),
            json!({
                "state": "ready",
                "version": null,
                "attached": false,
                "generation": 1,
            })
        );
    }

    #[test]
    fn every_status_serializes_with_the_expected_state_tag() {
        let cases = [
            (AppStatus::NotConfigured, "not_configured"),
            (AppStatus::Starting, "starting"),
            (
                AppStatus::Ready {
                    version: None,
                    attached: false,
                    generation: 1,
                },
                "ready",
            ),
            (
                AppStatus::Restarting {
                    attempt: 1,
                    retry_in_ms: 500,
                },
                "restarting",
            ),
            (
                AppStatus::Failed {
                    reason: "no daemon".into(),
                },
                "failed",
            ),
            (AppStatus::Stopped, "stopped"),
        ];

        for (status, tag) in cases {
            let value = serde_json::to_value(status).unwrap();
            assert_eq!(value["state"], tag);
        }
    }

    #[tokio::test]
    async fn ready_keeps_attached_generation_and_version() {
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("listener addr");
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            tokio::time::sleep(Duration::from_secs(1)).await;
            drop(stream);
        });

        let (client, _notifications) = crate::rpc::RpcClient::connect(addr).await.expect("connect");
        let state = DaemonState::Ready {
            client,
            listen: "127.0.0.1:7605".parse().unwrap(),
            generation: 7,
            pid: 4242,
            attached: true,
        };

        assert_eq!(
            status_of(&state, Some("1.1.0".into())),
            AppStatus::Ready {
                version: Some("1.1.0".into()),
                attached: true,
                generation: 7,
            }
        );

        server.abort();
    }

    #[test]
    fn resolve_daemon_path_prefers_the_environment_value() {
        let exe_dir = Path::new("C:/apps/setu");
        let path = resolve_daemon_path(Some(OsString::from("C:/tools/setu-daemon.exe")), exe_dir);
        assert_eq!(path, PathBuf::from("C:/tools/setu-daemon.exe"));
    }

    #[test]
    fn resolve_daemon_path_falls_back_next_to_the_executable() {
        let exe_dir = Path::new("C:/apps/setu");
        let expected = exe_dir.join(format!("setu-daemon{}", std::env::consts::EXE_SUFFIX));
        assert_eq!(resolve_daemon_path(None, exe_dir), expected);
    }

    #[test]
    fn resolve_relay_prefers_a_non_blank_runtime_value() {
        assert_eq!(
            resolve_relay(Some(" ws://relay ".into()), Some("wss://compile")),
            Some("ws://relay".into())
        );
    }

    #[test]
    fn resolve_relay_skips_blank_runtime_and_falls_back_to_compile_time() {
        assert_eq!(
            resolve_relay(Some("   ".into()), Some(" wss://compile ")),
            Some("wss://compile".into())
        );
    }

    #[test]
    fn resolve_relay_returns_none_when_both_are_missing_or_blank() {
        assert_eq!(resolve_relay(None, None), None);
        assert_eq!(resolve_relay(Some(String::new()), Some("  ")), None);
    }
}
