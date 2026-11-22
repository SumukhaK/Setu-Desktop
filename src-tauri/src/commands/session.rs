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
    pub fn parse(raw: &str) -> Option<Self> {
        let bytes = raw.as_bytes();
        if bytes.len() != 11 || bytes[4] != b'-' {
            return None;
        }
        if bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && !byte.is_ascii_digit())
        {
            return None;
        }
        Some(Self(raw.to_owned()))
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

/// Clear the slot on every exit path, including cancellation and errors.
struct SlotGuard<'a>(&'a PendingConnect);

impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        let _ = self
            .0
             .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
    }
}

pub async fn connect_with_code(
    client: Option<RpcClient>,
    raw: &str,
    pending: &PendingConnect,
) -> ConnectOutcome {
    let Some(code) = PairingCode::parse(raw) else {
        return ConnectOutcome::Malformed;
    };
    let Some(client) = client else {
        return ConnectOutcome::NotReady;
    };
    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let mut slot = pending.0.lock().unwrap_or_else(PoisonError::into_inner);
        if slot.is_some() {
            return ConnectOutcome::AlreadyPending;
        }
        *slot = Some(cancel_tx);
    }
    let _guard = SlotGuard(pending);

    let result = client
        .call_cancellable(
            "session.connect",
            Some(json!({ "pairing_code": code.as_str(), "timeout_ms": 60000 })),
            cancel_rx,
        )
        .await;
    match result {
        Ok(value) => match serde_json::from_value::<SessionInfo>(value) {
            Ok(info) => ConnectOutcome::Connected {
                session_id: info.session_id,
                device_id: info.device_id,
                adb_addr: info.adb_addr,
            },
            Err(_) => ConnectOutcome::Failed { code: None },
        },
        Err(SetuError::BadCode) => ConnectOutcome::BadCode,
        Err(SetuError::Unavailable) => ConnectOutcome::Unavailable,
        Err(SetuError::Cancelled) => ConnectOutcome::Cancelled,
        Err(error) => ConnectOutcome::Failed { code: error.code() },
    }
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum StopOutcome {
    Stopped,
    NoSession,
    NotReady,
    Invalid,
    Failed { code: Option<i64> },
}

/// Stop one client session by its `s<n>` id. Rust owns the id validation and
/// the `session.stop` call; the UI only gets a typed outcome.
pub async fn stop_session(client: Option<RpcClient>, session_id: &str) -> StopOutcome {
    let bytes = session_id.as_bytes();
    if bytes.first() != Some(&b's')
        || bytes.len() < 2
        || bytes.len() > 10
        || !bytes[1..].iter().all(u8::is_ascii_digit)
    {
        return StopOutcome::Invalid;
    }
    let Some(client) = client else {
        return StopOutcome::NotReady;
    };

    match client
        .call("session.stop", Some(json!({ "session_id": session_id })))
        .await
    {
        Ok(_) => StopOutcome::Stopped,
        Err(SetuError::NoSession) => StopOutcome::NoSession,
        Err(error) => StopOutcome::Failed { code: error.code() },
    }
}

pub fn cancel_pending(pending: &PendingConnect) -> bool {
    let sender = pending
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    match sender {
        Some(sender) => sender.send(()).is_ok(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_code_accepts_only_four_dash_six() {
        assert!(PairingCode::parse("0012-345678").is_some());
        for bad in [
            "0012345678",
            "00123-45678",
            "0012-34567a",
            "",
            "00012-345678",
        ] {
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
    fn stop_outcome_json_uses_the_bridge_tags() {
        let stopped = serde_json::to_value(StopOutcome::Stopped).unwrap();
        assert_eq!(stopped["outcome"], "stopped");
        assert_eq!(
            serde_json::to_value(StopOutcome::NoSession).unwrap()["outcome"],
            "no_session"
        );
        assert_eq!(
            serde_json::to_value(StopOutcome::Invalid).unwrap()["outcome"],
            "invalid"
        );
        let failed = serde_json::to_value(StopOutcome::Failed { code: Some(-32603) }).unwrap();
        assert_eq!(failed["outcome"], "failed");
        assert_eq!(failed["code"], -32603);
    }

    #[test]
    fn cancel_pending_without_a_connect_returns_false() {
        assert!(!cancel_pending(&PendingConnect::default()));
    }
}
