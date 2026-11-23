//! DT-09 Quit command tests against FakeDaemon (P17, AD-1).

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use setu_desktop::commands::quit::{end_all_sessions, QuitLatch, QuitOutcome};
use setu_desktop::rpc::RpcClient;
use tokio::time::timeout;

mod support;
use support::fake_daemon::FakeDaemon;

const TEST_TIMEOUT: Duration = Duration::from_secs(5);

fn session_info(id: &str) -> Value {
    json!({
        "session_id": id,
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

fn stop_ids(fake: &FakeDaemon) -> Vec<String> {
    fake.received()
        .into_iter()
        .filter(|request| request["method"] == "session.stop")
        .map(|request| {
            request["params"]["session_id"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        })
        .collect()
}

#[tokio::test]
async fn no_client_is_not_ready_and_sends_nothing() {
    let fake = FakeDaemon::start().await;
    let outcome = timeout(TEST_TIMEOUT, end_all_sessions(None))
        .await
        .expect("end finishes");
    assert_eq!(outcome, QuitOutcome::NotReady);
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn an_empty_list_ends_nothing() {
    let (fake, client) = connect_fake().await;
    fake.reply_with("session.list", json!({ "sessions": [] }));

    let outcome = timeout(TEST_TIMEOUT, end_all_sessions(Some(client)))
        .await
        .expect("end finishes");

    assert_eq!(
        outcome,
        QuitOutcome::Ended {
            stopped: 0,
            failed: 0
        }
    );
    fake.wait_for_requests(1).await;
    assert_eq!(fake.received()[0]["method"], "session.list");
    assert!(stop_ids(&fake).is_empty());
}

#[tokio::test]
async fn two_sessions_are_stopped_in_list_order() {
    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "session.list",
        json!({ "sessions": [session_info("s1"), session_info("s2")] }),
    );
    fake.reply_with("session.stop", json!({}));
    fake.reply_with("session.stop", json!({}));

    let outcome = timeout(TEST_TIMEOUT, end_all_sessions(Some(client)))
        .await
        .expect("end finishes");

    assert_eq!(
        outcome,
        QuitOutcome::Ended {
            stopped: 2,
            failed: 0
        }
    );
    fake.wait_for_requests(3).await;
    assert_eq!(stop_ids(&fake), ["s1", "s2"]);
}

#[tokio::test]
async fn a_stop_error_does_not_skip_the_next_session() {
    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "session.list",
        json!({ "sessions": [session_info("s1"), session_info("s2")] }),
    );
    // -32020 is `no_session` (SDK §2.3) and counts as stopped.
    fake.reply_with_error(
        "session.stop",
        json!({ "code": -32020, "message": "no session" }),
    );
    fake.reply_with_error(
        "session.stop",
        json!({ "code": -32603, "message": "internal error" }),
    );

    let outcome = timeout(TEST_TIMEOUT, end_all_sessions(Some(client)))
        .await
        .expect("end finishes");

    assert_eq!(
        outcome,
        QuitOutcome::Ended {
            stopped: 1,
            failed: 1
        }
    );
    fake.wait_for_requests(3).await;
    assert_eq!(stop_ids(&fake), ["s1", "s2"]);
}

#[tokio::test]
async fn a_not_paired_code_is_failed_not_stopped() {
    let (fake, client) = connect_fake().await;
    fake.reply_with("session.list", json!({ "sessions": [session_info("s1")] }));
    // The prompt calls -32012 NoSession; SDK §2.3 maps it to `not_paired`.
    fake.reply_with_error(
        "session.stop",
        json!({ "code": -32012, "message": "not paired" }),
    );

    let outcome = timeout(TEST_TIMEOUT, end_all_sessions(Some(client)))
        .await
        .expect("end finishes");

    assert_eq!(
        outcome,
        QuitOutcome::Ended {
            stopped: 0,
            failed: 1
        }
    );
}

#[tokio::test]
async fn a_list_error_reports_its_code_and_sends_no_stop() {
    let (fake, client) = connect_fake().await;
    fake.reply_with_error(
        "session.list",
        json!({ "code": -32603, "message": "internal error" }),
    );

    let outcome = timeout(TEST_TIMEOUT, end_all_sessions(Some(client)))
        .await
        .expect("end finishes");

    assert_eq!(outcome, QuitOutcome::ListFailed { code: Some(-32603) });
    fake.wait_for_requests(1).await;
    assert!(stop_ids(&fake).is_empty());
}

#[tokio::test]
async fn stray_notifications_do_not_turn_into_stops() {
    let (fake, client) = connect_fake().await;
    fake.reply_delayed(
        "session.list",
        json!({ "sessions": [] }),
        Duration::from_millis(1),
    );
    fake.notify("event", json!({ "type": "listening" })).await;
    let mut frame = json!({
        "jsonrpc": "2.0",
        "method": "event",
        "params": { "type": "session_up" }
    })
    .to_string()
    .into_bytes();
    frame.push(b'\n');
    fake.send_raw(&frame).await;

    let outcome = timeout(TEST_TIMEOUT, end_all_sessions(Some(client)))
        .await
        .expect("end finishes");

    assert_eq!(
        outcome,
        QuitOutcome::Ended {
            stopped: 0,
            failed: 0
        }
    );
    assert!(stop_ids(&fake).is_empty());
    fake.close().await;
}

#[tokio::test]
async fn the_latch_admits_exactly_one_beginner() {
    let latch = Arc::new(QuitLatch::default());
    assert!(latch.try_begin());
    assert!(!latch.try_begin());

    let other = Arc::clone(&latch);
    let third = timeout(TEST_TIMEOUT, tokio::spawn(async move { other.try_begin() }))
        .await
        .expect("task finishes")
        .expect("task joins");
    assert!(!third);
}
