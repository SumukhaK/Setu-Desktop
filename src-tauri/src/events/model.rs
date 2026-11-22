//! Typed, secret-free event model (AD-11).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::rpc::{Notification, SetuError};

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HubEvent {
    Listening {
        session: String,
        addr: String,
        device_id: String,
    },
    SessionUp {
        session: String,
        addr: String,
        device_id: String,
    },
    Retrying {
        session: String,
        attempt: u32,
        delay_ms: u64,
    },
    SessionDown {
        session: String,
        abnormal: bool,
    },
    PathDown {
        session: String,
        tunnel_id: String,
        reason: String,
        transport: String,
    },
    PathUp {
        session: String,
        tunnel_id: String,
        transport: String,
        outage_ms: u64,
    },
    PathLost {
        session: String,
        tunnel_id: String,
        reason: String,
        outage_ms: u64,
    },
    SessionExpired {
        session: String,
        device_id: String,
        reason: String,
    },
    PeerClosed {
        session: String,
        device_id: String,
        peer_reason: String,
    },
    AuditSessionStart {
        device_id: String,
        tunnel_id: String,
        transport: String,
    },
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub struct SessionInfo {
    pub session_id: String,
    pub adb_addr: String,
    pub device_id: String,
    pub started: String,
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HubMessage {
    Snapshot {
        epoch: u64,
        generation: u64,
        sessions: Vec<SessionInfo>,
    },
    Event {
        epoch: u64,
        generation: u64,
        event: HubEvent,
    },
    Unavailable {
        generation: u64,
    },
}

#[derive(Clone, PartialEq, Debug)]
pub enum Parsed {
    Event(HubEvent),
    Dropped { count: u64 },
    Ignored,
}

/// Parse one daemon notification into the allowlisted, secret-free bridge.
pub fn parse_notification(notification: &Notification) -> Parsed {
    match notification.method.as_str() {
        "events.dropped" => notification
            .params
            .get("count")
            .and_then(Value::as_u64)
            .map_or(Parsed::Ignored, |count| Parsed::Dropped { count }),
        "event" => parse_event(&notification.params).map_or(Parsed::Ignored, Parsed::Event),
        _ => Parsed::Ignored,
    }
}

/// Only §1.5 types with every required field of the right type cross the
/// bridge. Error strings (`retrying.error`, `session_down.error`) are dropped.
fn parse_event(params: &Value) -> Option<HubEvent> {
    let typ = params.get("type").and_then(Value::as_str)?;
    let fields = params.get("fields");
    if typ == "audit" {
        return parse_audit_session_start(fields);
    }
    let session = params.get("session").and_then(Value::as_str)?;
    if session.is_empty() {
        return None;
    }
    let text = |key: &str| {
        fields
            .and_then(|fields| fields.get(key))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let number = |key: &str| {
        fields
            .and_then(|fields| fields.get(key))
            .and_then(Value::as_u64)
    };
    let session = session.to_owned();

    let event = match typ {
        "listening" => HubEvent::Listening {
            session,
            addr: text("addr")?,
            device_id: text("device_id")?,
        },
        "session_up" => HubEvent::SessionUp {
            session,
            addr: text("addr")?,
            device_id: text("device_id")?,
        },
        "retrying" => HubEvent::Retrying {
            session,
            attempt: u32::try_from(number("attempt")?).ok()?,
            delay_ms: number("delay_ms")?,
        },
        "session_down" => HubEvent::SessionDown {
            session,
            abnormal: fields.and_then(|fields| fields.get("error")).is_some(),
        },
        "path_down" => HubEvent::PathDown {
            session,
            tunnel_id: text("session_id")?,
            reason: text("reason")?,
            transport: text("transport")?,
        },
        "path_up" => HubEvent::PathUp {
            session,
            tunnel_id: text("session_id")?,
            transport: text("transport")?,
            outage_ms: number("outage_ms")?,
        },
        "path_lost" => HubEvent::PathLost {
            session,
            tunnel_id: text("session_id")?,
            reason: text("reason")?,
            outage_ms: number("outage_ms")?,
        },
        "session_expired" => HubEvent::SessionExpired {
            session,
            device_id: text("device_id")?,
            reason: text("reason")?,
        },
        "peer_closed" => HubEvent::PeerClosed {
            session,
            device_id: text("device_id")?,
            peer_reason: text("peer_reason")?,
        },
        _ => return None,
    };
    Some(event)
}

/// The one audit shape that crosses the bridge. Audit events have an empty
/// top-level `session`; only three allowlisted fields survive.
fn parse_audit_session_start(fields: Option<&Value>) -> Option<HubEvent> {
    let fields = fields?;
    let text = |key: &str| fields.get(key).and_then(Value::as_str);
    if text("event")? != "session_start" || text("role")? != "desktop" {
        return None;
    }

    let device_id = text("device")?;
    if device_id.is_empty() {
        return None;
    }

    let tunnel_id = text("session")?;
    if tunnel_id.len() != 16
        || !tunnel_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }

    let transport = text("transport")?;
    if !matches!(transport, "lan" | "relay-tcp" | "relay-ws" | "relay-wss") {
        return None;
    }

    Some(HubEvent::AuditSessionStart {
        device_id: device_id.to_owned(),
        tunnel_id: tunnel_id.to_owned(),
        transport: transport.to_owned(),
    })
}

#[derive(Deserialize)]
struct SessionList {
    sessions: Vec<SessionInfo>,
}

/// Strictly parse the `session.list` result; a bad shape is a failed list.
pub fn parse_session_list(value: &Value) -> Result<Vec<SessionInfo>, SetuError> {
    serde_json::from_value::<SessionList>(value.clone())
        .map(|list| list.sessions)
        .map_err(|_| SetuError::UnexpectedResult)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn event(typ: &str, session: &str, fields: Value) -> Notification {
        Notification {
            method: "event".to_owned(),
            params: json!({
                "time": "2026-11-21T09:12:03.1Z",
                "type": typ,
                "session": session,
                "fields": fields,
            }),
        }
    }

    #[test]
    fn allowlisted_events_parse() {
        let cases = vec![
            (
                event(
                    "listening",
                    "s1",
                    json!({ "addr": "127.0.0.1:1", "device_id": "pixel-7" }),
                ),
                HubEvent::Listening {
                    session: "s1".into(),
                    addr: "127.0.0.1:1".into(),
                    device_id: "pixel-7".into(),
                },
            ),
            (
                event(
                    "session_up",
                    "s1",
                    json!({ "addr": "127.0.0.1:1", "device_id": "pixel-7" }),
                ),
                HubEvent::SessionUp {
                    session: "s1".into(),
                    addr: "127.0.0.1:1".into(),
                    device_id: "pixel-7".into(),
                },
            ),
            (
                event("retrying", "s1", json!({ "attempt": 2, "delay_ms": 500 })),
                HubEvent::Retrying {
                    session: "s1".into(),
                    attempt: 2,
                    delay_ms: 500,
                },
            ),
            (
                event("session_down", "s1", json!({})),
                HubEvent::SessionDown {
                    session: "s1".into(),
                    abnormal: false,
                },
            ),
            (
                event(
                    "path_down",
                    "s1",
                    json!({
                        "session_id": "4be1c0d2a9f37e11",
                        "reason": "keepalive_timeout",
                        "transport": "relay-wss",
                    }),
                ),
                HubEvent::PathDown {
                    session: "s1".into(),
                    tunnel_id: "4be1c0d2a9f37e11".into(),
                    reason: "keepalive_timeout".into(),
                    transport: "relay-wss".into(),
                },
            ),
            (
                event(
                    "path_up",
                    "s1",
                    json!({
                        "session_id": "4be1c0d2a9f37e11",
                        "transport": "lan",
                        "outage_ms": 2900,
                    }),
                ),
                HubEvent::PathUp {
                    session: "s1".into(),
                    tunnel_id: "4be1c0d2a9f37e11".into(),
                    transport: "lan".into(),
                    outage_ms: 2900,
                },
            ),
            (
                event(
                    "path_lost",
                    "s1",
                    json!({
                        "session_id": "4be1c0d2a9f37e11",
                        "reason": "rejoin_window_expired",
                        "outage_ms": 90000,
                    }),
                ),
                HubEvent::PathLost {
                    session: "s1".into(),
                    tunnel_id: "4be1c0d2a9f37e11".into(),
                    reason: "rejoin_window_expired".into(),
                    outage_ms: 90000,
                },
            ),
            (
                event(
                    "session_expired",
                    "s1",
                    json!({ "device_id": "pixel-7", "reason": "max_session_seconds" }),
                ),
                HubEvent::SessionExpired {
                    session: "s1".into(),
                    device_id: "pixel-7".into(),
                    reason: "max_session_seconds".into(),
                },
            ),
            (
                event(
                    "peer_closed",
                    "s1",
                    json!({ "device_id": "pixel-7", "peer_reason": "ended_on_device" }),
                ),
                HubEvent::PeerClosed {
                    session: "s1".into(),
                    device_id: "pixel-7".into(),
                    peer_reason: "ended_on_device".into(),
                },
            ),
        ];
        for (notification, expected) in cases {
            assert_eq!(parse_notification(&notification), Parsed::Event(expected));
        }
    }

    fn audit(fields: Value) -> Notification {
        // The daemon sends audit events with an empty `session` field.
        event("audit", "", fields)
    }

    fn session_start() -> Value {
        json!({
            "event": "session_start",
            "role": "desktop",
            "device": "pixel-7",
            "session": "4be1c0d2a9f37e11",
            "transport": "relay-wss",
            "user": "alice",
            "token_id": "t-123",
        })
    }

    #[test]
    fn an_audit_session_start_crosses_with_exactly_three_fields() {
        let parsed = parse_notification(&audit(session_start()));
        let expected = HubEvent::AuditSessionStart {
            device_id: "pixel-7".into(),
            tunnel_id: "4be1c0d2a9f37e11".into(),
            transport: "relay-wss".into(),
        };
        assert_eq!(parsed, Parsed::Event(expected.clone()));

        let value = serde_json::to_value(&expected).unwrap();
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["device_id", "transport", "tunnel_id", "type"]);
        let text = serde_json::to_string(&expected).unwrap();
        assert!(!text.contains("alice"), "user leaked: {text}");
        assert!(!text.contains("t-123"), "token_id leaked: {text}");
    }

    #[test]
    fn every_other_audit_record_is_ignored() {
        for fields in [
            json!({ "event": "adb_op", "role": "desktop", "device": "pixel-7", "session": "4be1c0d2a9f37e11", "transport": "lan" }),
            json!({ "event": "session_end", "role": "desktop", "device": "pixel-7", "session": "4be1c0d2a9f37e11", "transport": "lan" }),
            json!({ "event": "token_rotated", "role": "desktop", "device": "pixel-7", "session": "4be1c0d2a9f37e11", "transport": "lan" }),
        ] {
            assert_eq!(parse_notification(&audit(fields)), Parsed::Ignored);
        }

        let mut wrong_role = session_start();
        wrong_role["role"] = json!("relay");
        assert_eq!(parse_notification(&audit(wrong_role)), Parsed::Ignored);

        let mut wrong_event = session_start();
        wrong_event["event"] = json!("session_started");
        assert_eq!(parse_notification(&audit(wrong_event)), Parsed::Ignored);
    }

    #[test]
    fn malformed_audit_session_starts_are_ignored() {
        let cases = [
            (
                "bad transport",
                json!({ "event": "session_start", "role": "desktop", "device": "pixel-7", "session": "4be1c0d2a9f37e11", "transport": "bluetooth" }),
            ),
            (
                "missing device",
                json!({ "event": "session_start", "role": "desktop", "session": "4be1c0d2a9f37e11", "transport": "lan" }),
            ),
            (
                "empty device",
                json!({ "event": "session_start", "role": "desktop", "device": "", "session": "4be1c0d2a9f37e11", "transport": "lan" }),
            ),
            (
                "short tunnel",
                json!({ "event": "session_start", "role": "desktop", "device": "pixel-7", "session": "4be1c0d2a9f37e", "transport": "lan" }),
            ),
            (
                "long tunnel",
                json!({ "event": "session_start", "role": "desktop", "device": "pixel-7", "session": "4be1c0d2a9f37e111", "transport": "lan" }),
            ),
            (
                "uppercase tunnel",
                json!({ "event": "session_start", "role": "desktop", "device": "pixel-7", "session": "4BE1C0D2A9F37E11", "transport": "lan" }),
            ),
            (
                "non-hex tunnel",
                json!({ "event": "session_start", "role": "desktop", "device": "pixel-7", "session": "4be1c0d2a9f37e1g", "transport": "lan" }),
            ),
            (
                "wrong role",
                json!({ "event": "session_start", "role": "device", "device": "pixel-7", "session": "4be1c0d2a9f37e11", "transport": "lan" }),
            ),
        ];
        for (label, fields) in cases {
            assert_eq!(
                parse_notification(&audit(fields)),
                Parsed::Ignored,
                "{label}"
            );
        }
    }

    #[test]
    fn unrelated_and_malformed_events_are_ignored() {
        for typ in [
            "audit",
            "token_updated",
            "pairing_code",
            "adb_pair",
            "paired",
            "future_thing",
        ] {
            assert_eq!(
                parse_notification(&event(typ, "s1", json!({}))),
                Parsed::Ignored,
                "type {typ}"
            );
        }
        assert_eq!(
            parse_notification(&event(
                "path_up",
                "s1",
                json!({ "transport": "lan", "outage_ms": 1 })
            )),
            Parsed::Ignored,
            "missing fields.session_id"
        );
        assert_eq!(
            parse_notification(&event(
                "path_up",
                "",
                json!({ "session_id": "4be1c0d2a9f37e11", "transport": "lan", "outage_ms": 1 })
            )),
            Parsed::Ignored,
            "empty session"
        );
    }

    #[test]
    fn session_down_keeps_abnormal_but_never_the_error_text() {
        let parsed = parse_notification(&event(
            "session_down",
            "s1",
            json!({ "error": "relay said SECRET-DETAIL" }),
        ));
        assert_eq!(
            parsed,
            Parsed::Event(HubEvent::SessionDown {
                session: "s1".into(),
                abnormal: true,
            })
        );
        let text = match &parsed {
            Parsed::Event(event) => serde_json::to_string(event).unwrap(),
            other => panic!("expected an event, got {other:?}"),
        };
        assert!(!text.contains("SECRET-DETAIL"), "error text leaked: {text}");
    }

    #[test]
    fn events_dropped_yields_the_count() {
        let notification = Notification {
            method: "events.dropped".to_owned(),
            params: json!({ "count": 17 }),
        };
        assert_eq!(
            parse_notification(&notification),
            Parsed::Dropped { count: 17 }
        );
    }

    #[test]
    fn snapshot_and_event_serialize_with_the_bridge_field_names() {
        let snapshot = serde_json::to_value(HubMessage::Snapshot {
            epoch: 3,
            generation: 2,
            sessions: vec![SessionInfo {
                session_id: "s1".into(),
                adb_addr: "127.0.0.1:1".into(),
                device_id: "pixel-7".into(),
                started: "2026-11-21T09:12:03Z".into(),
            }],
        })
        .unwrap();
        assert_eq!(snapshot["kind"], "snapshot");
        assert_eq!(snapshot["epoch"], 3);
        assert_eq!(snapshot["generation"], 2);
        assert_eq!(snapshot["sessions"][0]["session_id"], "s1");
        assert_eq!(snapshot["sessions"][0]["adb_addr"], "127.0.0.1:1");
        assert_eq!(snapshot["sessions"][0]["device_id"], "pixel-7");
        assert_eq!(snapshot["sessions"][0]["started"], "2026-11-21T09:12:03Z");

        let event_message = serde_json::to_value(HubMessage::Event {
            epoch: 3,
            generation: 2,
            event: HubEvent::PathUp {
                session: "s1".into(),
                tunnel_id: "4be1c0d2a9f37e11".into(),
                transport: "lan".into(),
                outage_ms: 2900,
            },
        })
        .unwrap();
        assert_eq!(event_message["kind"], "event");
        assert_eq!(event_message["epoch"], 3);
        assert_eq!(event_message["event"]["type"], "path_up");
        assert_eq!(event_message["event"]["session"], "s1");
        assert_eq!(event_message["event"]["tunnel_id"], "4be1c0d2a9f37e11");
        assert_eq!(event_message["event"]["transport"], "lan");
        assert_eq!(event_message["event"]["outage_ms"], 2900);
    }
}
