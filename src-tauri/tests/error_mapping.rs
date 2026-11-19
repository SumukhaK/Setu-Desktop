//! P11 error-table mapping (docs/JOURNEYS.md row P11, API_SPEC v1.1.0 §2.3).

use serde_json::{json, Value};
use setu_desktop::rpc::{from_error_object, SetuError};

/// Error table discriminant for the P11 mapping rows.
#[derive(Debug)]
enum Expected {
    Protocol,
    Unauthorized,
    Denied,
    Unavailable,
    NotPaired,
    BadCode,
    Revoked,
    TokenInvalid,
    TokenExpired,
    NoGrant,
    Blocked,
    NoSession,
    AuditDisabled,
    Cancelled,
    AdbPairFailed,
    Unsupported,
    SessionExpired,
    PeerClosed,
    Busy,
}

const DAEMON_MESSAGE: &str = "daemon said";

fn error_object(code: i64, kind: Option<&str>) -> Value {
    match kind {
        Some(kind) => json!({ "code": code, "message": DAEMON_MESSAGE, "data": { "kind": kind } }),
        None => json!({ "code": code, "message": DAEMON_MESSAGE }),
    }
}

/// Acceptance P11: every row of the daemon error table maps to its typed
/// variant, and codes outside the table stay raw `Denied` (AD-2).
#[test]
fn p11_daemon_error_codes_map_to_their_typed_variants() {
    let rows: Vec<(i64, Option<&str>, Expected)> = vec![
        (-32700, None, Expected::Protocol),
        (-32600, None, Expected::Protocol),
        (-32601, None, Expected::Protocol),
        (-32602, None, Expected::Protocol),
        (-32603, None, Expected::Protocol),
        (-32001, None, Expected::Unauthorized),
        (-32010, Some("denied"), Expected::Denied),
        (-32011, Some("unavailable"), Expected::Unavailable),
        (-32012, Some("not_paired"), Expected::NotPaired),
        (-32013, Some("bad_code"), Expected::BadCode),
        (-32014, Some("revoked"), Expected::Revoked),
        (-32015, Some("token_invalid"), Expected::TokenInvalid),
        (-32016, Some("token_expired"), Expected::TokenExpired),
        (-32017, Some("no_grant"), Expected::NoGrant),
        (-32018, Some("blocked"), Expected::Blocked),
        (-32020, Some("no_session"), Expected::NoSession),
        (-32021, Some("audit_disabled"), Expected::AuditDisabled),
        (-32022, Some("cancelled"), Expected::Cancelled),
        (-32023, Some("adb_pair_failed"), Expected::AdbPairFailed),
        (-32024, Some("unsupported"), Expected::Unsupported),
        (-32025, Some("session_expired"), Expected::SessionExpired),
        (-32026, Some("peer_closed"), Expected::PeerClosed),
        (-32027, Some("busy"), Expected::Busy),
        // Unknown codes are never guessed (AD-2): raw code and kind preserved.
        (-32019, Some("something_unlisted"), Expected::Denied),
        (-32099, None, Expected::Denied),
    ];
    for (code, kind, expected) in rows {
        let error = from_error_object(&error_object(code, kind));
        match (expected, &error) {
            (
                Expected::Protocol,
                SetuError::Protocol {
                    code: mapped,
                    message,
                },
            ) => {
                assert_eq!(*mapped, code, "row {code}");
                assert_eq!(message, DAEMON_MESSAGE, "row {code}");
            }
            (Expected::Unauthorized, SetuError::Unauthorized) => {}
            (
                Expected::Denied,
                SetuError::Denied {
                    code: mapped,
                    kind: mapped_kind,
                    message,
                },
            ) => {
                assert_eq!(*mapped, code, "row {code}");
                assert_eq!(mapped_kind, kind.unwrap_or(""), "row {code}");
                assert_eq!(message, DAEMON_MESSAGE, "row {code}");
            }
            (Expected::Unavailable, SetuError::Unavailable) => {}
            (Expected::NotPaired, SetuError::NotPaired) => {}
            (Expected::BadCode, SetuError::BadCode) => {}
            (Expected::Revoked, SetuError::Revoked) => {}
            (Expected::TokenInvalid, SetuError::TokenInvalid) => {}
            (Expected::TokenExpired, SetuError::TokenExpired) => {}
            (Expected::NoGrant, SetuError::NoGrant) => {}
            (Expected::Blocked, SetuError::Blocked) => {}
            (Expected::NoSession, SetuError::NoSession) => {}
            (Expected::AuditDisabled, SetuError::AuditDisabled) => {}
            (Expected::Cancelled, SetuError::Cancelled) => {}
            (Expected::AdbPairFailed, SetuError::AdbPairFailed) => {}
            (Expected::Unsupported, SetuError::Unsupported) => {}
            (Expected::SessionExpired, SetuError::SessionExpired) => {}
            (Expected::PeerClosed, SetuError::PeerClosed) => {}
            (Expected::Busy, SetuError::Busy) => {}
            (_, other) => panic!("code {code} ({kind:?}) mapped to {other:?}"),
        }
        assert_eq!(error.code(), Some(code), "row {code}");
    }
}
