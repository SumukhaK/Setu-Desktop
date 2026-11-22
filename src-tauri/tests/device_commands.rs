//! DT-08 device list, forget and nickname tests against FakeDaemon (P08, P17).

use std::time::Duration;

use serde_json::json;
use setu_desktop::commands::devices::{
    forget_device, list_devices, set_nickname, DeviceRow, ForgetOutcome, ListOutcome,
    NicknameOutcome,
};
use setu_desktop::rpc::RpcClient;
use setu_desktop::store::nicknames::NicknameStore;
use tempfile::tempdir;
use tokio::time::timeout;

mod support;
use support::fake_daemon::FakeDaemon;

const TEST_TIMEOUT: Duration = Duration::from_secs(5);

async fn connect_fake() -> (FakeDaemon, RpcClient) {
    let fake = FakeDaemon::start().await;
    let (client, _notifications) = timeout(TEST_TIMEOUT, RpcClient::connect(fake.addr()))
        .await
        .expect("connect finishes")
        .expect("connect succeeds");
    (fake, client)
}

fn store(dir: &tempfile::TempDir) -> NicknameStore {
    NicknameStore::new(&dir.path().join("setu").join("solo"))
}

#[tokio::test]
async fn p08_list_joins_nicknames_by_exact_id_and_keeps_daemon_order() {
    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "devices.list",
        json!({ "devices": [
            { "id": "pixel-7", "paired": true, "source": "state" },
            { "id": "tablet-9", "paired": true, "source": "state" }
        ]}),
    );
    let dir = tempdir().unwrap();
    let store = store(&dir);
    store.set("pixel-7", Some("Work phone")).unwrap();

    let outcome = timeout(TEST_TIMEOUT, list_devices(Some(client), &store))
        .await
        .expect("list finishes");
    assert_eq!(
        outcome,
        ListOutcome::Listed {
            devices: vec![
                DeviceRow {
                    device_id: "pixel-7".into(),
                    paired: true,
                    source: "state".into(),
                    nickname: Some("Work phone".into()),
                },
                DeviceRow {
                    device_id: "tablet-9".into(),
                    paired: true,
                    source: "state".into(),
                    nickname: None,
                },
            ]
        }
    );
    let received = fake.received();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0]["method"], "devices.list");
    assert!(
        received[0].get("params").is_none(),
        "devices.list has no params"
    );
}

#[tokio::test]
async fn an_empty_or_broken_list_maps_to_listed_empty_or_failed() {
    let (fake, client) = connect_fake().await;
    fake.reply_with("devices.list", json!({ "devices": [] }));
    let dir = tempdir().unwrap();
    let store = store(&dir);
    assert_eq!(
        list_devices(Some(client), &store).await,
        ListOutcome::Listed { devices: vec![] }
    );

    let (fake, client) = connect_fake().await;
    fake.reply_with("devices.list", json!({ "devices": 5 }));
    assert_eq!(
        list_devices(Some(client), &store).await,
        ListOutcome::Failed { code: None }
    );
    assert_eq!(fake.received()[0]["method"], "devices.list");

    let (fake, client) = connect_fake().await;
    fake.reply_with_error(
        "devices.list",
        json!({ "code": -32603, "message": "internal" }),
    );
    assert_eq!(
        list_devices(Some(client), &store).await,
        ListOutcome::Failed { code: Some(-32603) }
    );
    assert_eq!(list_devices(None, &store).await, ListOutcome::NotReady);
}

#[tokio::test]
async fn p17_forget_with_an_empty_result_sends_the_exact_id_and_drops_the_nickname() {
    let (fake, client) = connect_fake().await;
    fake.reply_with("devices.forget", json!({}));
    let dir = tempdir().unwrap();
    let store = store(&dir);
    store.set("pixel-7", Some("Work phone")).unwrap();

    assert_eq!(
        forget_device(Some(client), "pixel-7", &store).await,
        ForgetOutcome::Forgotten
    );
    assert_eq!(fake.received()[0]["method"], "devices.forget");
    assert_eq!(
        fake.received()[0]["params"],
        json!({ "device_id": "pixel-7" })
    );
    assert!(store.load().is_empty());
}

#[tokio::test]
async fn forget_accepts_a_reply_with_no_result_field_at_all() {
    let (fake, client) = connect_fake().await;
    // v1.1.0 omits `result` on success; the client maps it to Value::Null.
    fake.send_raw(b"{\"jsonrpc\":\"2.0\",\"id\":1}\n").await;
    let dir = tempdir().unwrap();
    let store = store(&dir);
    store.set("pixel-7", Some("Work phone")).unwrap();

    assert_eq!(
        forget_device(Some(client), "pixel-7", &store).await,
        ForgetOutcome::Forgotten
    );
    assert!(store.load().is_empty());
}

#[tokio::test]
async fn forget_error_mapping_and_nickname_retention() {
    let dir = tempdir().unwrap();
    let store = store(&dir);
    store.set("pixel-7", Some("Work phone")).unwrap();

    let (fake, client) = connect_fake().await;
    fake.reply_with_error(
        "devices.forget",
        json!({ "code": -32012, "message": "not paired" }),
    );
    assert_eq!(
        forget_device(Some(client), "pixel-7", &store).await,
        ForgetOutcome::NotPaired
    );
    assert!(
        store.load().is_empty(),
        "a missing pin drops the nickname too"
    );

    store.set("pixel-7", Some("Work phone")).unwrap();
    let (fake, client) = connect_fake().await;
    fake.reply_with_error(
        "devices.forget",
        json!({ "code": -32603, "message": "internal" }),
    );
    assert_eq!(
        forget_device(Some(client), "pixel-7", &store).await,
        ForgetOutcome::Failed { code: Some(-32603) }
    );
    assert_eq!(
        store.load().get("pixel-7").map(String::as_str),
        Some("Work phone"),
        "a real failure keeps the nickname"
    );
    assert_eq!(fake.received()[0]["method"], "devices.forget");
}

#[tokio::test]
async fn invalid_ids_never_call_the_daemon() {
    let (fake, client) = connect_fake().await;
    let dir = tempdir().unwrap();
    let store = store(&dir);
    for id in ["", "a\u{0}b"] {
        assert_eq!(
            forget_device(Some(client.clone()), id, &store).await,
            ForgetOutcome::Invalid,
            "id {id:?}"
        );
        assert_eq!(
            set_nickname(&store, id, "Work"),
            NicknameOutcome::Invalid,
            "id {id:?}"
        );
    }
    assert_eq!(
        forget_device(None, "pixel-7", &store).await,
        ForgetOutcome::NotReady
    );
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn a_rename_never_changes_the_id_key_or_the_daemon_list() {
    let dir = tempdir().unwrap();
    let store = store(&dir);
    store.set("pixel-7", Some("Old")).unwrap();
    assert_eq!(
        set_nickname(&store, "pixel-7", "  New name  "),
        NicknameOutcome::Saved {
            nickname: Some("New name".into())
        }
    );
    assert_eq!(
        store.load().get("pixel-7").map(String::as_str),
        Some("New name")
    );

    let (fake, client) = connect_fake().await;
    fake.reply_with(
        "devices.list",
        json!({ "devices": [{ "id": "pixel-7", "paired": true, "source": "state" }] }),
    );
    assert_eq!(
        list_devices(Some(client), &store).await,
        ListOutcome::Listed {
            devices: vec![DeviceRow {
                device_id: "pixel-7".into(),
                paired: true,
                source: "state".into(),
                nickname: Some("New name".into()),
            }]
        }
    );
    assert_eq!(fake.received()[0]["method"], "devices.list");
    assert_eq!(
        set_nickname(&store, "pixel-7", ""),
        NicknameOutcome::Saved { nickname: None }
    );
}
