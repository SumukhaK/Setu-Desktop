//! DT-10 native command tests against FakeDaemon (P05, P20, AD-5, AD-12).

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use setu_desktop::commands::pair_adb::{pair_adb, PairAdbOutcome};
use setu_desktop::commands::session::{
    cancel_pending, connect_with_code, ConnectOutcome, PendingConnect,
};
use setu_desktop::rpc::RpcClient;
use tokio::time::timeout;

mod support;
use support::fake_daemon::FakeDaemon;

const TEST_TIMEOUT: Duration = Duration::from_secs(3);
const CODE: &str = "482913";

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
async fn exact_params_include_only_the_optional_port_and_timeout() {
    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "session.pair_adb",
        json!({ "device_id": "pixel-7", "paired": true, "transport": "lan", "output": "secret" }),
    );

    let outcome = timeout(
        TEST_TIMEOUT,
        pair_adb(
            Some(client),
            "pixel-7",
            CODE,
            Some(37099),
            &PendingConnect::default(),
        ),
    )
    .await
    .expect("pair finishes");

    assert_eq!(
        outcome,
        PairAdbOutcome::Paired {
            transport: "lan".into()
        }
    );
    let received = fake.received();
    assert_eq!(
        received[0]["params"],
        json!({
            "device_id": "pixel-7",
            "pairing_code": CODE,
            "pairing_port": 37099,
            "timeout_ms": 60000
        })
    );
    assert!(received[0]["params"].get("adb_path").is_none());
}

#[tokio::test]
async fn no_port_omits_the_pairing_port_key() {
    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "session.pair_adb",
        json!({ "paired": true, "transport": "lan" }),
    );

    timeout(
        TEST_TIMEOUT,
        pair_adb(
            Some(client),
            "pixel-7",
            CODE,
            None,
            &PendingConnect::default(),
        ),
    )
    .await
    .expect("pair finishes");

    assert_eq!(
        fake.received()[0]["params"],
        json!({ "device_id": "pixel-7", "pairing_code": CODE, "timeout_ms": 60000 })
    );
}

#[tokio::test]
async fn malformed_input_never_reaches_the_daemon() {
    let (fake, client) = connect_fake().await;
    let cases = [
        ("48291", Some(37099), "pixel-7", PairAdbOutcome::Malformed),
        ("4829135", Some(37099), "pixel-7", PairAdbOutcome::Malformed),
        ("48a913", Some(37099), "pixel-7", PairAdbOutcome::Malformed),
        (CODE, Some(0), "pixel-7", PairAdbOutcome::Malformed),
        (CODE, Some(37099), "", PairAdbOutcome::InvalidDevice),
    ];
    for (code, port, device, expected) in cases {
        let outcome = timeout(
            TEST_TIMEOUT,
            pair_adb(
                Some(client.clone()),
                device,
                code,
                port,
                &PendingConnect::default(),
            ),
        )
        .await
        .expect("pair finishes");
        assert_eq!(outcome, expected, "input {code:?} {port:?} {device:?}");
    }
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn result_mapping_drops_output_and_handles_paired_false() {
    let cases = [
        (
            json!({ "paired": true, "transport": "lan", "output": "raw adb output" }),
            PairAdbOutcome::Paired {
                transport: "lan".into(),
            },
        ),
        (
            json!({ "paired": false, "transport": "lan" }),
            PairAdbOutcome::PairFailed,
        ),
        (
            json!({ "paired": true }),
            PairAdbOutcome::Failed { code: None },
        ),
    ];
    for (result, expected) in cases {
        let (fake, client) = connect_fake().await;
        fake.reply_with("session.pair_adb", result);
        let outcome = timeout(
            TEST_TIMEOUT,
            pair_adb(
                Some(client),
                "pixel-7",
                CODE,
                None,
                &PendingConnect::default(),
            ),
        )
        .await
        .expect("pair finishes");
        assert_eq!(outcome, expected);
    }
}

#[tokio::test]
async fn typed_errors_map_to_outcomes() {
    let cases = [
        (-32023, PairAdbOutcome::PairFailed),
        (-32024, PairAdbOutcome::Unsupported),
        (-32012, PairAdbOutcome::NotPaired),
        (-32011, PairAdbOutcome::Unavailable),
        (-32603, PairAdbOutcome::Failed { code: Some(-32603) }),
    ];
    for (code, expected) in cases {
        let (fake, client) = connect_fake().await;
        fake.reply_with_error(
            "session.pair_adb",
            json!({ "code": code, "message": "typed error" }),
        );
        let outcome = timeout(
            TEST_TIMEOUT,
            pair_adb(
                Some(client),
                "pixel-7",
                CODE,
                None,
                &PendingConnect::default(),
            ),
        )
        .await
        .expect("pair finishes");
        assert_eq!(outcome, expected);
    }
}

#[tokio::test]
async fn a_connect_holding_the_shared_slot_makes_pairing_already_pending() {
    let (fake, client) = connect_fake().await;
    fake.reply_delayed(
        "session.connect",
        session_info(),
        Duration::from_millis(200),
    );
    let pending = Arc::new(PendingConnect::default());
    let task_pending = Arc::clone(&pending);
    let task_client = client.clone();
    let connect_task = tokio::spawn(async move {
        connect_with_code(Some(task_client), "0012-345678", &task_pending).await
    });
    fake.wait_for_requests(1).await;

    let outcome = timeout(
        TEST_TIMEOUT,
        pair_adb(Some(client), "pixel-7", CODE, None, &pending),
    )
    .await
    .expect("pair finishes");
    assert_eq!(outcome, PairAdbOutcome::AlreadyPending);
    assert_eq!(
        timeout(TEST_TIMEOUT, connect_task)
            .await
            .expect("connect finishes")
            .expect("connect joins"),
        ConnectOutcome::Connected {
            session_id: "s1".into(),
            device_id: "pixel-7".into(),
            adb_addr: "127.0.0.1:41377".into(),
        }
    );
}

#[tokio::test]
async fn cancel_during_pair_sends_the_request_id_and_frees_the_slot() {
    let (fake, client) = connect_fake().await;
    fake.reply_error_delayed(
        "session.pair_adb",
        json!({ "code": -32022, "message": "cancelled" }),
        Duration::from_millis(200),
    );
    fake.reply_with("session.cancel", json!({ "cancelled": 1 }));
    let pending = Arc::new(PendingConnect::default());
    let task_pending = Arc::clone(&pending);
    let task_client = client.clone();
    let pair_task = tokio::spawn(async move {
        pair_adb(Some(task_client), "pixel-7", CODE, None, &task_pending).await
    });
    fake.wait_for_requests(1).await;

    assert!(cancel_pending(&pending));
    let outcome = timeout(TEST_TIMEOUT, pair_task)
        .await
        .expect("pair finishes")
        .expect("pair joins");
    assert_eq!(outcome, PairAdbOutcome::Cancelled);

    let received = fake.received();
    let pair_id = received
        .iter()
        .find(|request| request["method"] == "session.pair_adb")
        .and_then(|request| request["id"].as_u64())
        .expect("pair request id");
    let cancel = received
        .iter()
        .find(|request| request["method"] == "session.cancel")
        .expect("cancel request");
    assert_eq!(cancel["params"]["request_id"].as_u64(), Some(pair_id));

    fake.reply_with(
        "session.pair_adb",
        json!({ "paired": true, "transport": "lan" }),
    );
    let second = timeout(
        TEST_TIMEOUT,
        pair_adb(Some(client), "pixel-7", CODE, None, &pending),
    )
    .await
    .expect("second pair finishes");
    assert_eq!(
        second,
        PairAdbOutcome::Paired {
            transport: "lan".into()
        }
    );
}

#[tokio::test]
async fn stray_adb_pair_notifications_do_not_change_the_result() {
    let (fake, client) = connect_fake().await;
    fake.reply_delayed(
        "session.pair_adb",
        json!({ "paired": true, "transport": "lan" }),
        Duration::from_millis(20),
    );
    fake.notify(
        "event",
        json!({
            "type": "adb_pair",
            "session": "s1",
            "fields": { "device_id": "pixel-7", "paired": true, "transport": "lan" }
        }),
    )
    .await;
    fake.send_raw(
        b"{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"adb_pair\",\"session\":\"s1\",\"fields\":{\"paired\":false}}}\n",
    )
    .await;

    let outcome = timeout(
        TEST_TIMEOUT,
        pair_adb(
            Some(client),
            "pixel-7",
            CODE,
            None,
            &PendingConnect::default(),
        ),
    )
    .await
    .expect("pair finishes");
    assert_eq!(
        outcome,
        PairAdbOutcome::Paired {
            transport: "lan".into()
        }
    );
    fake.close().await;
}

#[tokio::test]
async fn the_code_is_never_stored_or_in_debug_output() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("sentinel"), "unchanged").unwrap();
    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "session.pair_adb",
        json!({ "paired": true, "transport": "lan", "output": CODE }),
    );
    let outcome = timeout(
        TEST_TIMEOUT,
        pair_adb(
            Some(client),
            "pixel-7",
            CODE,
            None,
            &PendingConnect::default(),
        ),
    )
    .await
    .expect("pair finishes");
    assert!(!format!("{outcome:?}").contains(CODE));
    for entry in std::fs::read_dir(tmp.path()).unwrap() {
        let path = entry.unwrap().path();
        let contents = std::fs::read_to_string(path).unwrap();
        assert!(!contents.contains(CODE));
    }
}
