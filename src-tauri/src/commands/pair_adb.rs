//! Android 11+ wireless-debugging pairing. The six-digit system code is
//! ephemeral: no Debug, Clone or Serialize, and the daemon's raw output is
//! dropped immediately (AD-5, DT-10).

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::commands::devices::valid_device_id;
use crate::commands::session::PendingConnect;
use crate::commands::session::{claim_slot, SlotGuard};
use crate::rpc::{RpcClient, SetuError};

pub struct AdbPairCode(String);

impl AdbPairCode {
    pub fn parse(raw: &str) -> Option<Self> {
        if raw.len() == 6 && raw.bytes().all(|byte| byte.is_ascii_digit()) {
            Some(Self(raw.to_owned()))
        } else {
            None
        }
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum PairAdbOutcome {
    Paired { transport: String },
    Malformed,
    InvalidDevice,
    NotReady,
    AlreadyPending,
    PairFailed,
    Unsupported,
    NotPaired,
    Unavailable,
    Cancelled,
    Failed { code: Option<i64> },
}

#[derive(Deserialize)]
struct PairResult {
    paired: bool,
    transport: String,
}

pub async fn pair_adb(
    client: Option<RpcClient>,
    device_id: &str,
    raw_code: &str,
    pairing_port: Option<u16>,
    pending: &PendingConnect,
) -> PairAdbOutcome {
    // Validate in the contract's order: a bad input never touches the daemon.
    let Some(code) = AdbPairCode::parse(raw_code) else {
        return PairAdbOutcome::Malformed;
    };
    if pairing_port == Some(0) {
        return PairAdbOutcome::Malformed;
    }
    if !valid_device_id(device_id) {
        return PairAdbOutcome::InvalidDevice;
    }
    let Some(client) = client else {
        return PairAdbOutcome::NotReady;
    };
    let Some((cancel_rx, token)) = claim_slot(pending) else {
        return PairAdbOutcome::AlreadyPending;
    };
    let _guard = SlotGuard { pending, token };

    let mut params = json!({
        "device_id": device_id,
        "pairing_code": code.as_str(),
        "timeout_ms": 60000
    });
    if let Some(port) = pairing_port {
        params["pairing_port"] = json!(port);
    }

    match client
        .call_cancellable("session.pair_adb", Some(params), cancel_rx)
        .await
    {
        Ok(value) => match serde_json::from_value::<PairResult>(value) {
            Ok(result) if result.paired => PairAdbOutcome::Paired {
                transport: result.transport,
            },
            Ok(_) => PairAdbOutcome::PairFailed,
            Err(_) => PairAdbOutcome::Failed { code: None },
        },
        Err(SetuError::AdbPairFailed) => PairAdbOutcome::PairFailed,
        Err(SetuError::Unsupported) => PairAdbOutcome::Unsupported,
        Err(SetuError::NotPaired) => PairAdbOutcome::NotPaired,
        Err(SetuError::Unavailable) => PairAdbOutcome::Unavailable,
        Err(SetuError::Cancelled) => PairAdbOutcome::Cancelled,
        Err(error) => PairAdbOutcome::Failed { code: error.code() },
    }
}
