//! Solo device list, forget and desktop-local nicknames.

use serde::{Deserialize, Serialize};
use serde_json::{from_value, json, Value};

use crate::rpc::{RpcClient, SetuError};
use crate::store::nicknames::{normalize_nickname, NicknameStore};

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

#[derive(Deserialize)]
struct DaemonDevice {
    id: String,
    paired: bool,
    source: String,
}

#[derive(Deserialize)]
struct DeviceList {
    devices: Vec<DaemonDevice>,
}

pub async fn list_devices(client: Option<RpcClient>, store: &NicknameStore) -> ListOutcome {
    let Some(client) = client else {
        return ListOutcome::NotReady;
    };
    let value = match client.call("devices.list", None).await {
        Ok(value) => value,
        Err(error) => return ListOutcome::Failed { code: error.code() },
    };
    let Ok(list) = from_value::<DeviceList>(value) else {
        return ListOutcome::Failed { code: None };
    };
    let nicknames = store.load();
    let devices = list
        .devices
        .into_iter()
        .map(|device| DeviceRow {
            device_id: device.id.clone(),
            paired: device.paired,
            source: device.source,
            nickname: nicknames.get(&device.id).cloned(),
        })
        .collect();
    ListOutcome::Listed { devices }
}

pub async fn forget_device(
    client: Option<RpcClient>,
    device_id: &str,
    store: &NicknameStore,
) -> ForgetOutcome {
    if !valid_device_id(device_id) {
        return ForgetOutcome::Invalid;
    }
    let Some(client) = client else {
        return ForgetOutcome::NotReady;
    };
    let params: Value = json!({ "device_id": device_id });
    match client.call("devices.forget", Some(params)).await {
        Ok(_) => {
            let _ = store.set(device_id, None);
            ForgetOutcome::Forgotten
        }
        Err(SetuError::NotPaired) => {
            let _ = store.set(device_id, None);
            ForgetOutcome::NotPaired
        }
        Err(error) => ForgetOutcome::Failed { code: error.code() },
    }
}

pub fn set_nickname(store: &NicknameStore, device_id: &str, raw: &str) -> NicknameOutcome {
    if !valid_device_id(device_id) {
        return NicknameOutcome::Invalid;
    }
    let Ok(nickname) = normalize_nickname(raw) else {
        return NicknameOutcome::Invalid;
    };
    match store.set(device_id, nickname.as_deref()) {
        Ok(()) => NicknameOutcome::Saved { nickname },
        Err(_) => NicknameOutcome::Failed,
    }
}
