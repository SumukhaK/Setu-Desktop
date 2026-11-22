//! RPC client behaviour for DT-01: concurrency, busy retry, notifications
//! and disconnect semantics, against a fake daemon. Error-table mapping
//! lives in `error_mapping.rs`, framing edge cases in `framing.rs`.

mod support;

use std::time::Duration;

use serde_json::{json, Value};
use setu_desktop::rpc::{Notification, RpcClient, SetuError, VersionInfo, MAX_LINE_BYTES};
use support::fake_daemon::FakeDaemon;
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc::UnboundedReceiver, oneshot};
use tokio::time::timeout;

const TEST_TIMEOUT: Duration = Duration::from_secs(5);

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

fn cancelled_error() -> Value {
    json!({ "code": -32022, "message": "cancelled", "data": { "kind": "cancelled" } })
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
    fake.wait_for_requests(1).await; // let the request reach the fake
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
    fake.wait_for_requests(1).await;
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
    fake.wait_for_requests(1).await; // let the request reach the fake
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

// AD-3: dropping every client handle releases the connection.
#[tokio::test]
async fn dropping_every_client_handle_closes_the_connection() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (client, notifications) = RpcClient::connect(listener.local_addr().unwrap())
        .await
        .unwrap();
    let (mut server_side, _) = listener.accept().await.unwrap();
    let extra = client.clone();
    drop(client);
    drop(extra);
    drop(notifications);
    let mut byte = [0u8; 1];
    let read = timeout(TEST_TIMEOUT, server_side.read(&mut byte)).await;
    assert!(
        matches!(read, Ok(Ok(0))),
        "connection still open after the last handle dropped"
    );
}

// AD-3: a surviving clone keeps the connection usable; only the last
// handle dropping may close it.
#[tokio::test]
async fn the_connection_stays_open_while_a_clone_is_alive() {
    let (fake, client, notifications) = connect_fake().await;
    fake.reply_with("m", json!({ "ok": true }));
    let survivor = client.clone();
    drop(client);
    drop(notifications);
    let result = timeout(TEST_TIMEOUT, survivor.call("m", None))
        .await
        .expect("call finishes")
        .unwrap();
    assert_eq!(result, json!({ "ok": true }));
}

/// AD-12: cancelling mid-call sends `session.cancel` with this call's own
/// numeric id and still waits for the daemon's `-32022` reply.
#[tokio::test]
async fn cancel_mid_call_sends_cancel_with_the_request_id_and_returns_cancelled() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_error_delayed(
        "session.connect",
        cancelled_error(),
        Duration::from_millis(300),
    );
    fake.reply_with("session.cancel", json!({ "cancelled": 1 }));
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let pending = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .call_cancellable(
                    "session.connect",
                    Some(json!({ "pairing_code": "0012-345678" })),
                    cancel_rx,
                )
                .await
        })
    };
    fake.wait_for_requests(1).await;
    let connect_id = fake.received()[0]["id"].clone();
    cancel_tx.send(()).expect("cancel receiver is alive");

    let result = timeout(TEST_TIMEOUT, pending)
        .await
        .expect("call finishes")
        .expect("join");
    assert!(matches!(result, Err(SetuError::Cancelled)));
    let received = fake.received();
    let cancel = received
        .iter()
        .find(|request| request["method"] == "session.cancel")
        .expect("session.cancel was sent");
    assert_eq!(cancel["params"]["request_id"], connect_id);
}

/// A dropped cancel sender means "never cancel".
#[tokio::test]
async fn a_dropped_cancel_sender_behaves_like_call() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with("m", json!({ "ok": true }));
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    drop(cancel_tx);

    let result = timeout(TEST_TIMEOUT, client.call_cancellable("m", None, cancel_rx))
        .await
        .expect("call finishes");
    assert_eq!(result.unwrap(), json!({ "ok": true }));
    assert_eq!(fake.received().len(), 1);
    assert_eq!(fake.received()[0]["method"], "m");
}

/// Cancelling during the busy back-off returns Cancelled without sending the
/// retry.
#[tokio::test]
async fn cancel_during_busy_backoff_skips_the_retry() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with_error("m", busy_error());
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let pending = {
        let client = client.clone();
        tokio::spawn(async move { client.call_cancellable("m", None, cancel_rx).await })
    };
    fake.wait_for_requests(1).await;
    // Let the immediate busy reply reach the client so the cancel lands in
    // the back-off window, not while the first request is still in flight.
    tokio::time::sleep(Duration::from_millis(20)).await;
    let sent = cancel_tx.send(());
    assert!(
        sent.is_ok(),
        "cancel receiver gone; requests={:?}",
        fake.received()
    );

    let result = timeout(TEST_TIMEOUT, pending)
        .await
        .expect("call finishes")
        .expect("join");
    assert!(matches!(result, Err(SetuError::Cancelled)));
    let received = fake.received();
    assert_eq!(received.len(), 1, "no retry was sent: {received:?}");
    assert_eq!(received[0]["method"], "m");
    assert!(received
        .iter()
        .all(|request| request["method"] != "session.cancel"));
}

/// A cancel signal after the reply has arrived changes nothing.
#[tokio::test]
async fn cancel_after_the_reply_arrives_does_nothing() {
    let (fake, client, _notifications) = connect_fake().await;
    fake.reply_with("m", json!({ "ok": true }));
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let result = timeout(TEST_TIMEOUT, client.call_cancellable("m", None, cancel_rx))
        .await
        .expect("call finishes");
    assert_eq!(result.unwrap(), json!({ "ok": true }));
    // The receiver is gone with the finished call; signalling it is a no-op.
    let _ = cancel_tx.send(());
    assert!(fake
        .received()
        .iter()
        .all(|request| request["method"] != "session.cancel"));
}
