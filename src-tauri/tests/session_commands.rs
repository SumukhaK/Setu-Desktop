//! DT-04 pairing command tests against FakeDaemon (P02, P19, AD-5, AD-12).

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use setu_desktop::commands::session::{connect_with_device, stop_session, StopOutcome};
use setu_desktop::commands::{cancel_pending, connect_with_code, ConnectOutcome, PendingConnect};
use setu_desktop::rpc::RpcClient;
use tokio::time::timeout;

mod support;
use support::fake_daemon::FakeDaemon;

const TEST_TIMEOUT: Duration = Duration::from_secs(5);
const CODE: &str = "0012-345678";

fn session_info() -> Value {
    json!({
        "session_id": "s1",
        "adb_addr": "127.0.0.1:41377",
        "device_id": "pixel-7",
        "started": "2026-11-21T00:00:00Z",
    })
}

async fn connect_fake() -> (FakeDaemon, RpcClient) {
    let fake = FakeDaemon::start().await;
    let (client, _notifications) = timeout(TEST_TIMEOUT, RpcClient::connect(fake.addr()))
        .await
        .expect("connect finishes")
        .expect("connect succeeds");
    (fake, client)
}

#[tokio::test]
async fn p02_a_valid_code_sends_exactly_the_connect_params_and_yields_connected() {
    let (fake, client) = connect_fake().await;
    fake.reply_with("session.connect", session_info());
    let pending = PendingConnect::default();

    let outcome = timeout(
        TEST_TIMEOUT,
        connect_with_code(Some(client), CODE, &pending),
    )
    .await
    .expect("connect finishes");
    assert_eq!(
        outcome,
        ConnectOutcome::Connected {
            session_id: "s1".into(),
            device_id: "pixel-7".into(),
            adb_addr: "127.0.0.1:41377".into(),
        }
    );

    let received = fake.received();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0]["method"], "session.connect");
    assert_eq!(
        received[0]["params"],
        json!({ "pairing_code": CODE, "timeout_ms": 60000 })
    );
}

#[tokio::test]
async fn malformed_and_not_ready_never_call_the_daemon() {
    let (fake, client) = connect_fake().await;
    let pending = PendingConnect::default();
    assert_eq!(
        connect_with_code(Some(client), "0012345678", &pending).await,
        ConnectOutcome::Malformed
    );
    assert_eq!(
        connect_with_code(None, CODE, &pending).await,
        ConnectOutcome::NotReady
    );
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn typed_errors_map_to_outcomes() {
    let cases = [
        (-32013, ConnectOutcome::BadCode),
        (-32011, ConnectOutcome::Unavailable),
        (-32020, ConnectOutcome::Failed { code: Some(-32020) }),
    ];
    for (code, expected) in cases {
        let (fake, client) = connect_fake().await;
        fake.reply_with_error(
            "session.connect",
            json!({ "code": code, "message": "denied" }),
        );
        let pending = PendingConnect::default();
        let outcome = timeout(
            TEST_TIMEOUT,
            connect_with_code(Some(client), CODE, &pending),
        )
        .await
        .expect("connect finishes");
        assert_eq!(outcome, expected, "code {code}");
    }
}

#[tokio::test]
async fn p19_cancel_signals_the_exact_pending_request() {
    let (fake, client) = connect_fake().await;
    fake.reply_error_delayed(
        "session.connect",
        json!({
            "code": -32022,
            "message": "cancelled",
            "data": { "kind": "cancelled" },
        }),
        Duration::from_millis(300),
    );
    fake.reply_with("session.cancel", json!({ "cancelled": 1 }));

    let pending = Arc::new(PendingConnect::default());
    let connect_client = client.clone();
    let task_pending = Arc::clone(&pending);
    let task =
        tokio::spawn(
            async move { connect_with_code(Some(connect_client), CODE, &task_pending).await },
        );
    fake.wait_for_requests(1).await;
    let connect_id = fake.received()[0]["id"].clone();

    assert!(cancel_pending(&pending));
    let outcome = timeout(TEST_TIMEOUT, task)
        .await
        .expect("connect finishes")
        .expect("join");
    assert_eq!(outcome, ConnectOutcome::Cancelled);

    let received = fake.received();
    let cancel = received
        .iter()
        .find(|request| request["method"] == "session.cancel")
        .expect("session.cancel was sent");
    assert_eq!(cancel["params"]["request_id"], connect_id);
}

#[tokio::test]
async fn a_second_concurrent_connect_is_rejected_and_the_slot_is_cleared() {
    let (fake, client) = connect_fake().await;
    fake.reply_delayed(
        "session.connect",
        session_info(),
        Duration::from_millis(300),
    );
    let pending = Arc::new(PendingConnect::default());

    let first_client = client.clone();
    let first_pending = Arc::clone(&pending);
    let first =
        tokio::spawn(
            async move { connect_with_code(Some(first_client), CODE, &first_pending).await },
        );
    fake.wait_for_requests(1).await;

    let second = timeout(
        TEST_TIMEOUT,
        connect_with_code(Some(client.clone()), CODE, &pending),
    )
    .await
    .expect("second connect finishes");
    assert_eq!(second, ConnectOutcome::AlreadyPending);

    let first_outcome = timeout(TEST_TIMEOUT, first)
        .await
        .expect("first connect finishes")
        .expect("join");
    assert_eq!(
        first_outcome,
        ConnectOutcome::Connected {
            session_id: "s1".into(),
            device_id: "pixel-7".into(),
            adb_addr: "127.0.0.1:41377".into(),
        }
    );

    fake.reply_with("session.connect", session_info());
    let third = timeout(
        TEST_TIMEOUT,
        connect_with_code(Some(client), CODE, &pending),
    )
    .await
    .expect("third connect finishes");
    assert!(matches!(third, ConnectOutcome::Connected { .. }));
}

#[tokio::test]
async fn a_lost_connection_fails_without_a_code_and_unrelated_events_are_ignored() {
    let (fake, client) = connect_fake().await;
    fake.reply_delayed("session.connect", session_info(), Duration::from_secs(60));
    let pending = PendingConnect::default();
    let connect_client = client.clone();
    let task =
        tokio::spawn(async move { connect_with_code(Some(connect_client), CODE, &pending).await });
    fake.wait_for_requests(1).await;
    fake.send_raw(
        b"{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"future_thing\",\"session\":\"s1\",\"fields\":{}}}\n",
    )
    .await;
    fake.notify("event", json!({ "type": "session_up", "session": "s1" }))
        .await;
    fake.close().await;

    let outcome = timeout(TEST_TIMEOUT, task)
        .await
        .expect("connect finishes")
        .expect("join");
    assert_eq!(outcome, ConnectOutcome::Failed { code: None });
}

#[tokio::test]
async fn the_code_never_appears_in_an_outcome_only_in_daemon_params() {
    let (fake, client) = connect_fake().await;
    fake.reply_with("session.connect", session_info());
    let pending = PendingConnect::default();
    let outcome = connect_with_code(Some(client), CODE, &pending).await;

    let text = format!("{outcome:?}") + &serde_json::to_string(&outcome).unwrap();
    assert!(!text.contains(CODE), "code leaked into an outcome: {text}");
    assert_eq!(fake.received()[0]["params"]["pairing_code"], CODE);
}

#[tokio::test]
async fn device_connect_sends_exact_params_and_returns_connected() {
    let (fake, client) = connect_fake().await;
    fake.reply_with("session.connect", session_info());
    let pending = PendingConnect::default();

    let outcome = timeout(
        TEST_TIMEOUT,
        connect_with_device(Some(client), "pixel-7", &pending),
    )
    .await
    .expect("connect finishes");
    assert_eq!(
        outcome,
        ConnectOutcome::Connected {
            session_id: "s1".into(),
            device_id: "pixel-7".into(),
            adb_addr: "127.0.0.1:41377".into(),
        }
    );
    let received = fake.received();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0]["method"], "session.connect");
    assert_eq!(
        received[0]["params"],
        json!({ "device_id": "pixel-7", "timeout_ms": 60000 })
    );
}

#[tokio::test]
async fn device_connect_maps_typed_errors() {
    let cases = [
        (-32011, ConnectOutcome::Unavailable),
        (-32012, ConnectOutcome::NotPaired),
        (-32014, ConnectOutcome::Revoked),
    ];
    for (code, expected) in cases {
        let (fake, client) = connect_fake().await;
        fake.reply_with_error(
            "session.connect",
            json!({ "code": code, "message": "denied" }),
        );
        let pending = PendingConnect::default();
        let outcome = timeout(
            TEST_TIMEOUT,
            connect_with_device(Some(client), "pixel-7", &pending),
        )
        .await
        .expect("connect finishes");
        assert_eq!(outcome, expected, "code {code}");
    }
}

#[tokio::test]
async fn device_connect_can_be_cancelled_with_the_shared_cancel() {
    let (fake, client) = connect_fake().await;
    fake.reply_error_delayed(
        "session.connect",
        json!({
            "code": -32022,
            "message": "cancelled",
            "data": { "kind": "cancelled" },
        }),
        Duration::from_millis(300),
    );
    let pending = Arc::new(PendingConnect::default());
    let task_pending = Arc::clone(&pending);
    let task = tokio::spawn(async move {
        connect_with_device(Some(client.clone()), "pixel-7", &task_pending).await
    });
    fake.wait_for_requests(1).await;
    assert!(cancel_pending(&pending));
    let outcome = timeout(TEST_TIMEOUT, task)
        .await
        .expect("connect finishes")
        .expect("join");
    assert_eq!(outcome, ConnectOutcome::Cancelled);
}

#[tokio::test]
async fn a_code_connect_and_a_device_connect_share_the_pending_slot() {
    let (fake, client) = connect_fake().await;
    fake.reply_delayed(
        "session.connect",
        session_info(),
        Duration::from_millis(300),
    );
    let pending = Arc::new(PendingConnect::default());
    let first_pending = Arc::clone(&pending);
    let first_client = client.clone();
    let first =
        tokio::spawn(
            async move { connect_with_code(Some(first_client), CODE, &first_pending).await },
        );
    fake.wait_for_requests(1).await;

    let second = timeout(
        TEST_TIMEOUT,
        connect_with_device(Some(client), "pixel-7", &pending),
    )
    .await
    .expect("second connect finishes");
    assert_eq!(second, ConnectOutcome::AlreadyPending);

    let first_outcome = timeout(TEST_TIMEOUT, first)
        .await
        .expect("first connect finishes")
        .expect("join");
    assert!(matches!(first_outcome, ConnectOutcome::Connected { .. }));
}

#[tokio::test]
async fn an_invalid_device_id_is_malformed_without_calling_the_daemon() {
    let (fake, client) = connect_fake().await;
    let pending = PendingConnect::default();
    assert_eq!(
        connect_with_device(Some(client), "", &pending).await,
        ConnectOutcome::Malformed
    );
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn stop_sends_exactly_the_session_id_and_returns_stopped() {
    let (fake, client) = connect_fake().await;
    fake.reply_with("session.stop", json!({}));

    let outcome = timeout(TEST_TIMEOUT, stop_session(Some(client), "s1"))
        .await
        .expect("stop finishes");
    assert_eq!(outcome, StopOutcome::Stopped);

    let received = fake.received();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0]["method"], "session.stop");
    assert_eq!(received[0]["params"], json!({ "session_id": "s1" }));
}

#[tokio::test]
async fn no_session_maps_to_no_session() {
    let (fake, client) = connect_fake().await;
    fake.reply_with_error(
        "session.stop",
        json!({ "code": -32020, "message": "no such session" }),
    );
    let outcome = timeout(TEST_TIMEOUT, stop_session(Some(client), "s1"))
        .await
        .expect("stop finishes");
    assert_eq!(outcome, StopOutcome::NoSession);
}

#[tokio::test]
async fn other_stop_errors_keep_the_numeric_code() {
    let (fake, client) = connect_fake().await;
    fake.reply_with_error(
        "session.stop",
        json!({ "code": -32603, "message": "internal error" }),
    );
    let outcome = timeout(TEST_TIMEOUT, stop_session(Some(client), "s9"))
        .await
        .expect("stop finishes");
    assert_eq!(outcome, StopOutcome::Failed { code: Some(-32603) });
}

#[tokio::test]
async fn invalid_session_ids_never_call_the_daemon() {
    let (fake, client) = connect_fake().await;
    for id in ["s", "1", "s1;rm", "s1234567890", ""] {
        assert_eq!(
            stop_session(Some(client.clone()), id).await,
            StopOutcome::Invalid,
            "id {id:?}"
        );
    }
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn stop_without_a_ready_client_is_not_ready() {
    let outcome = stop_session(None, "s1").await;
    assert_eq!(outcome, StopOutcome::NotReady);
}
