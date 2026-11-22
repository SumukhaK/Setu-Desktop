//! Solo device list, forget and desktop-local nicknames.

use serde::Serialize;

use crate::rpc::RpcClient;
use crate::store::nicknames::NicknameStore;

#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct DeviceRow {
    pub device_id: String,
    pub paired: bool,
    pub source: String,
    pub nickname: Option<String>,
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ListOutcome {
    Listed { devices: Vec<DeviceRow> },
    NotReady,
    Failed { code: Option<i64> },
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ForgetOutcome {
    Forgotten,
    NotPaired,
    NotReady,
    Invalid,
    Failed { code: Option<i64> },
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum NicknameOutcome {
    Saved { nickname: Option<String> },
    Invalid,
    Failed,
}

pub fn valid_device_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}

pub async fn list_devices(_client: Option<RpcClient>, _store: &NicknameStore) -> ListOutcome {
    ListOutcome::NotReady
}

pub async fn forget_device(
    _client: Option<RpcClient>,
    _device_id: &str,
    _store: &NicknameStore,
) -> ForgetOutcome {
    ForgetOutcome::NotReady
}

pub fn set_nickname(_store: &NicknameStore, _device_id: &str, _raw: &str) -> NicknameOutcome {
    NicknameOutcome::Invalid
}
