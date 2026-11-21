//! Solo pairing: re-validate the code, own the in-flight request, map errors.

use std::sync::Mutex;
use std::sync::PoisonError;

use serde::Serialize;
use serde_json::json;
use tokio::sync::oneshot;

use crate::events::SessionInfo;
use crate::rpc::{RpcClient, SetuError};

/// A ten-digit code in `NNNN-NNNNNN` form. Never logged, persisted or `Debug`.
pub struct PairingCode(String);

impl PairingCode {
    pub fn parse(_raw: &str) -> Option<Self> {
        None
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ConnectOutcome {
    Connected {
        session_id: String,
        device_id: String,
        adb_addr: String,
    },
    Malformed,
    NotReady,
    AlreadyPending,
    BadCode,
    Unavailable,
    Cancelled,
    Failed {
        code: Option<i64>,
    },
}

#[derive(Default)]
pub struct PendingConnect(Mutex<Option<oneshot::Sender<()>>>);

pub async fn connect_with_code(
    _client: Option<RpcClient>,
    _raw: &str,
    _pending: &PendingConnect,
) -> ConnectOutcome {
    ConnectOutcome::Malformed
}

pub fn cancel_pending(_pending: &PendingConnect) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_code_accepts_only_four_dash_six() {
        assert!(PairingCode::parse("0012-345678").is_some());
        for bad in ["0012345678", "00123-45678", "0012-34567a", "", "00012-345678"] {
            assert!(PairingCode::parse(bad).is_none(), "accepted {bad:?}");
        }
    }

    #[test]
    fn outcome_json_uses_the_bridge_tags_and_field_names() {
        let connected = serde_json::to_value(ConnectOutcome::Connected {
            session_id: "s1".into(),
            device_id: "pixel-7".into(),
            adb_addr: "127.0.0.1:41377".into(),
        })
        .unwrap();
        assert_eq!(connected["outcome"], "connected");
        assert_eq!(connected["session_id"], "s1");
        assert_eq!(connected["device_id"], "pixel-7");
        assert_eq!(connected["adb_addr"], "127.0.0.1:41377");

        let failed = serde_json::to_value(ConnectOutcome::Failed { code: Some(-32020) }).unwrap();
        assert_eq!(failed["outcome"], "failed");
        assert_eq!(failed["code"], -32020);
        assert_eq!(
            serde_json::to_value(ConnectOutcome::BadCode).unwrap()["outcome"],
            "bad_code"
        );
    }

    #[test]
    fn cancel_pending_without_a_connect_returns_false() {
        assert!(!cancel_pending(&PendingConnect::default()));
    }
}
