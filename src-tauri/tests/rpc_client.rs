//! RPC client behaviour for DT-01: P11 error mapping, concurrency, busy
//! retry, notifications and disconnect semantics, against a fake daemon.

mod support;

use std::time::Duration;

use serde_json::{json, Value};
use setu_desktop::rpc::{
    from_error_object, Notification, RpcClient, SetuError, VersionInfo, MAX_LINE_BYTES,
};
use support::fake_daemon::FakeDaemon;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::{sleep, timeout};

const TEST_TIMEOUT: Duration = Duration::from_secs(5);

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

async fn connect_fake() -> (FakeDaemon, RpcClient, UnboundedReceiver<Notification>) {
    let fake = FakeDaemon::start().await;
    let (client, notifications) = timeout(TEST_TIMEOUT, RpcClient::connect(fake.addr()))
        .await
        .expect("connect finishes")
        .expect("connect succeeds");
    (fake, client, notifications)
}

fn busy_error() -> Value {
    json!({ "code": -32027, "message": "too many requests", "data": { "kind": "busy" } })
}

/// Concurrent calls resolve to their own results when the daemon answers
/// the second request before the first.
#[tokio::test]
async fn out_of_order_responses_resolve_each_caller_with_its_own_result() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_delayed("m1", json!({ "n": 1 }), Duration::from_millis(150));
    fake.reply_with("m2", json!({ "n": 2 }));
    let (first, second) = timeout(TEST_TIMEOUT, async {
        tokio::join!(client.call("m1", None), client.call("m2", None))
    })
    .await
    .expect("out-of-order calls finish");
    assert_eq!(first.unwrap(), json!({ "n": 1 }));
    assert_eq!(second.unwrap(), json!({ "n": 2 }));
}

/// Acceptance P11 (-32027): a busy reply is retried once internally with a
/// new id, and the retried request's result is returned (AD-4).
#[tokio::test]
async fn busy_reply_is_retried_once_with_a_new_id_and_returns_the_result() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with_error("m", busy_error());
    fake.reply_with("m", json!({ "attempt": "second" }));
    let result = timeout(TEST_TIMEOUT, client.call("m", None))
        .await
        .expect("call finishes")
        .unwrap();
    assert_eq!(result, json!({ "attempt": "second" }));
    let received = fake.received();
    assert_eq!(received.len(), 2);
    assert_eq!(received[0]["id"], 1);
    assert_eq!(received[1]["id"], 2);
}

/// Acceptance P11 (-32027): a second busy reply surfaces as `SetuError::Busy`
/// after exactly two requests.
#[tokio::test]
async fn second_busy_reply_returns_busy_after_exactly_two_requests() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with_error("m", busy_error());
    fake.reply_with_error("m", busy_error());
    let error = timeout(TEST_TIMEOUT, client.call("m", None))
        .await
        .expect("call finishes");
    assert!(matches!(error, Err(SetuError::Busy)));
    assert_eq!(error.unwrap_err().code(), Some(-32027));
    assert_eq!(fake.received().len(), 2);
}

/// `event` and `events.dropped` pass through the channel in arrival order
/// with their params intact.
#[tokio::test]
async fn notifications_arrive_in_order_with_params_intact() {
    let (fake, _client, mut notifications) = connect_fake().await;
    fake.notify("event", json!({ "type": "session_up", "session": "s1" }))
        .await;
    fake.notify("events.dropped", json!({ "count": 17 })).await;
    let first = timeout(TEST_TIMEOUT, notifications.recv())
        .await
        .expect("first notification arrives")
        .expect("first notification");
    let second = timeout(TEST_TIMEOUT, notifications.recv())
        .await
        .expect("second notification arrives")
        .expect("second notification");
    assert_eq!(first.method, "event");
    assert_eq!(
        first.params,
        json!({ "type": "session_up", "session": "s1" })
    );
    assert_eq!(second.method, "events.dropped");
    assert_eq!(second.params, json!({ "count": 17 }));
}

/// Acceptance P11 (terminal errors do not restart): a connection closed by
/// the daemon fails the pending call and every later call (AD-3), and the
/// notification channel ends.
#[tokio::test]
async fn eof_while_call_is_pending_fails_the_pending_call_and_every_later_call() {
    let (fake, client, mut notifications) = connect_fake().await;
    fake.reply_delayed("m", json!({ "late": true }), Duration::from_secs(60));
    let pending = {
        let client = client.clone();
        tokio::spawn(async move { client.call("m", None).await })
    };
    sleep(Duration::from_millis(100)).await; // let the request reach the fake
    fake.close().await;
    let pending = timeout(TEST_TIMEOUT, pending)
        .await
        .expect("pending call resolves")
        .expect("join");
    assert!(matches!(pending, Err(SetuError::Disconnected)));
    let later = timeout(TEST_TIMEOUT, client.call("m", None))
        .await
        .expect("later call resolves");
    assert!(matches!(later, Err(SetuError::Disconnected)));
    let ended = timeout(TEST_TIMEOUT, notifications.recv())
        .await
        .expect("channel ends");
    assert!(ended.is_none());
}

/// An incoming line over the 1 MiB cap is a framing violation: the client
/// disconnects, failing pending and later calls (AD-3).
#[tokio::test]
async fn oversize_incoming_line_disconnects_pending_and_later_calls() {
    let (fake, client, mut notifications) = connect_fake().await;
    fake.reply_delayed("m", json!({ "late": true }), Duration::from_secs(60));
    let pending = {
        let client = client.clone();
        tokio::spawn(async move { client.call("m", None).await })
    };
    sleep(Duration::from_millis(100)).await;
    let mut line = vec![b'a'; MAX_LINE_BYTES + 1];
    line.push(b'\n');
    fake.send_raw(&line).await;
    let pending = timeout(TEST_TIMEOUT, pending)
        .await
        .expect("pending call resolves")
        .expect("join");
    assert!(matches!(pending, Err(SetuError::Disconnected)));
    let later = timeout(TEST_TIMEOUT, client.call("m", None))
        .await
        .expect("later call resolves");
    assert!(matches!(later, Err(SetuError::Disconnected)));
    let ended = timeout(TEST_TIMEOUT, notifications.recv())
        .await
        .expect("channel ends");
    assert!(ended.is_none());
}

/// A response whose id matches no pending call is ignored without breaking
/// the connection or resolving anyone else's call.
#[tokio::test]
async fn response_with_an_unknown_id_is_ignored() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_delayed("m", json!({ "own": true }), Duration::from_millis(150));
    let pending = {
        let client = client.clone();
        tokio::spawn(async move { client.call("m", None).await })
    };
    sleep(Duration::from_millis(50)).await; // let the request reach the fake
    let stray = json!({ "jsonrpc": "2.0", "id": 999, "result": { "bogus": true } });
    fake.send_raw(format!("{stray}\n").as_bytes()).await;
    let result = timeout(TEST_TIMEOUT, pending)
        .await
        .expect("call resolves")
        .expect("join");
    assert_eq!(result.unwrap(), json!({ "own": true }));
}

/// Typed `auth` accepts `{ok: true}`.
#[tokio::test]
async fn auth_returns_ok_when_the_daemon_accepts_the_token() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with("auth", json!({ "ok": true }));
    timeout(TEST_TIMEOUT, client.auth("token-1"))
        .await
        .expect("auth finishes")
        .unwrap();
    let received = fake.received();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0]["method"], "auth");
    assert_eq!(received[0]["params"]["token"], "token-1");
}

/// Acceptance P11 (-32001): an auth failure maps to `Unauthorized`.
#[tokio::test]
async fn auth_unauthorized_maps_to_the_unauthorized_variant() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with_error("auth", json!({ "code": -32001, "message": "call auth" }));
    let error = timeout(TEST_TIMEOUT, client.auth("token-1"))
        .await
        .expect("auth finishes")
        .unwrap_err();
    assert!(matches!(error, SetuError::Unauthorized));
    assert_eq!(error.code(), Some(-32001));
    assert_eq!(fake.received().len(), 1);
}

/// Typed `version` parses `{version, mode, audit}`.
#[tokio::test]
async fn version_parses_version_mode_and_audit() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with(
        "version",
        json!({ "version": "1.1.0", "mode": "solo", "audit": false }),
    );
    let info = timeout(TEST_TIMEOUT, client.version())
        .await
        .expect("version finishes")
        .unwrap();
    assert_eq!(
        info,
        VersionInfo {
            version: "1.1.0".into(),
            mode: "solo".into(),
            audit: false
        }
    );
    assert_eq!(fake.received()[0]["method"], "version");
}

/// The auth token never appears in the `Debug` or `Display` output of an
/// error, though it did reach the daemon (AD-5).
#[tokio::test]
async fn auth_error_output_does_not_contain_the_token() {
    let token = "sup3r-secret-token-DO-NOT-PRINT";
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with_error("auth", json!({ "code": -32001, "message": "call auth" }));
    let error = timeout(TEST_TIMEOUT, client.auth(token))
        .await
        .expect("auth finishes")
        .unwrap_err();
    assert!(
        !format!("{error:?}").contains(token),
        "token leaked into Debug"
    );
    assert!(
        !error.to_string().contains(token),
        "token leaked into Display"
    );
    assert_eq!(fake.received()[0]["params"]["token"], token);
}
