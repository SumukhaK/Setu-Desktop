//! The real `doctor` RPC: Rust owns the timeout and redacts every returned
//! string before it crosses the bridge (P16, AD-5, AD-9).

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::log::redact;
use crate::rpc::RpcClient;

#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct DoctorCheck {
    pub name: String,
    pub status: String,
    pub detail: String,
    pub hint: Option<String>,
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum DoctorOutcome {
    Report {
        version: String,
        platform: String,
        ok: bool,
        checks: Vec<DoctorCheck>,
    },
    NotReady,
    TimedOut,
    Failed {
        code: Option<i64>,
    },
}

fn string_field(object: &serde_json::Map<String, Value>, name: &str) -> String {
    object
        .get(name)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned()
}

fn parse_report(value: Value) -> DoctorOutcome {
    let Some(object) = value.as_object() else {
        return DoctorOutcome::Failed { code: None };
    };
    let checks = object
        .get("checks")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_object)
                .map(|entry| {
                    let hint = string_field(entry, "hint");
                    DoctorCheck {
                        name: redact(&string_field(entry, "name")),
                        status: redact(&string_field(entry, "status")),
                        detail: redact(&string_field(entry, "detail")),
                        hint: if hint.is_empty() {
                            None
                        } else {
                            Some(redact(&hint))
                        },
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    DoctorOutcome::Report {
        version: redact(&string_field(object, "version")),
        platform: redact(&string_field(object, "platform")),
        ok: object.get("ok").and_then(Value::as_bool).unwrap_or(false),
        checks,
    }
}

pub async fn run_doctor(client: Option<RpcClient>, limit: Duration) -> DoctorOutcome {
    let Some(client) = client else {
        return DoctorOutcome::NotReady;
    };
    match tokio::time::timeout(limit, client.call("doctor", None)).await {
        Err(_) => DoctorOutcome::TimedOut,
        Ok(Err(error)) => DoctorOutcome::Failed { code: error.code() },
        Ok(Ok(value)) => parse_report(value),
    }
}
