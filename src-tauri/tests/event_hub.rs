//! DT-03b integration tests: one ordered, secret-free session stream (P21, P18, P17).

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::sync::{mpsc, watch};
use tokio::time::timeout;

use setu_desktop::daemon::{connect_authenticated, DaemonState};
use setu_desktop::events::{start, EventHub, HubEvent, HubMessage};
use setu_desktop::rpc::{RpcClient, SetuError};

mod support;
use support::fake_daemon::FakeDaemon;

const TEST_TIMEOUT: Duration = Duration::from_secs(3);

fn session_info(id: &str) -> Value {
    json!({
        "session_id": id,
        "adb_addr": "127.0.0.1:41377",
        "device_id": "pixel-7",
        "started": "2026-11-21T00:00:00Z",
    })
}

fn event(typ: &str, session: &str, fields: Value) -> Value {
    json!({
        "time": "2026-11-21T09:12:03.1Z",
        "type": typ,
        "session": session,
        "fields": fields,
    })
}

async fn next(rx: &mut mpsc::UnboundedReceiver<HubMessage>) -> HubMessage {
    timeout(TEST_TIMEOUT, rx.recv())
        .await
        .expect("a hub message in time")
        .expect("the hub channel is open")
}

async fn expect_silent(rx: &mut mpsc::UnboundedReceiver<HubMessage>, millis: u64) {
    assert!(
        timeout(Duration::from_millis(millis), rx.recv())
            .await
            .is_err(),
        "an unexpected message arrived early"
    );
}

fn epoch_of(message: &HubMessage) -> u64 {
    match message {
        HubMessage::Snapshot { epoch, .. } | HubMessage::Event { epoch, .. } => *epoch,
        HubMessage::Unavailable { .. } => panic!("expected an epoch-bearing message"),
    }
}

fn snapshot_ids(message: &HubMessage) -> Vec<String> {
    match message {
        HubMessage::Snapshot { sessions, .. } => {
            sessions.iter().map(|s| s.session_id.clone()).collect()
        }
        other => panic!("expected a snapshot, got {other:?}"),
    }
}

struct Harness {
    _tmp: TempDir,
    state_dir: PathBuf,
    fake: FakeDaemon,
    client: RpcClient,
    tx: watch::Sender<DaemonState>,
    hub: EventHub,
    messages: mpsc::UnboundedReceiver<HubMessage>,
    token: String,
}

impl Harness {
    async fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let state_dir = tmp.path().join("state");
        std::fs::create_dir_all(&state_dir).unwrap();
        let token = "t".repeat(64);
        std::fs::write(state_dir.join("daemon.token"), format!("{token}\n")).unwrap();

        let fake = FakeDaemon::start().await;
        let other = FakeDaemon::start().await;
        let (client, _notifications) = RpcClient::connect(other.addr()).await.unwrap();
        let (tx, states) = watch::channel(DaemonState::Starting);
        let (hub, messages) = start(states, state_dir.clone());
        Self {
            _tmp: tmp,
            state_dir,
            fake,
            client,
            tx,
            hub,
            messages,
            token,
        }
    }

    async fn ready(&self, generation: u64, listen: SocketAddr) {
        self.tx
            .send(DaemonState::Ready {
                client: self.client.clone(),
                listen,
                generation,
                pid: 1,
                attached: false,
            })
            .unwrap();
    }

    fn script_first_connection(&self) {
        self.fake.reply_with("auth", json!({ "ok": true }));
        self.fake
            .reply_with("events.subscribe", json!({ "subscribed": true }));
        self.fake
            .reply_with("session.list", json!({ "sessions": [session_info("s1")] }));
    }
}

#[tokio::test]
async fn auth_then_subscribe_then_list_then_snapshot() {
    let mut h = Harness::new().await;
    h.script_first_connection();
    h.ready(1, h.fake.addr()).await;

    let message = next(&mut h.messages).await;
    assert_eq!(snapshot_ids(&message), vec!["s1"]);

    h.fake.wait_for_requests(3).await;
    let received = h.fake.received();
    let methods: Vec<&str> = received
        .iter()
        .map(|request| request["method"].as_str().unwrap_or(""))
        .collect();
    assert_eq!(methods, vec!["auth", "events.subscribe", "session.list"]);
    assert_eq!(received[0]["params"]["token"], json!(h.token));
}

#[tokio::test]
async fn p21_events_during_resync_are_held_until_the_new_snapshot() {
    let mut h = Harness::new().await;
    h.script_first_connection();
    h.ready(1, h.fake.addr()).await;
    let first = next(&mut h.messages).await;
    let first_epoch = epoch_of(&first);

    h.fake.reply_delayed(
        "session.list",
        json!({ "sessions": [session_info("s1")] }),
        Duration::from_millis(300),
    );
    h.fake
        .notify("events.dropped", json!({ "count": 17 }))
        .await;
    h.fake
        .notify(
            "event",
            event(
                "path_up",
                "s1",
                json!({
                    "session_id": "4be1c0d2a9f37e11",
                    "transport": "lan",
                    "outage_ms": 10,
                }),
            ),
        )
        .await;

    expect_silent(&mut h.messages, 150).await;

    let snapshot = next(&mut h.messages).await;
    assert_eq!(snapshot_ids(&snapshot), vec!["s1"]);
    let new_epoch = epoch_of(&snapshot);
    assert!(new_epoch > first_epoch, "a resync must bump the epoch");

    let held = next(&mut h.messages).await;
    match held {
        HubMessage::Event {
            epoch,
            event: HubEvent::PathUp { session, .. },
            ..
        } => {
            assert_eq!(epoch, new_epoch);
            assert_eq!(session, "s1");
        }
        other => panic!("expected the held path_up event, got {other:?}"),
    }
}

#[tokio::test]
async fn p18_a_new_generation_reconnects_and_relists() {
    let mut h = Harness::new().await;
    h.script_first_connection();
    h.ready(1, h.fake.addr()).await;
    let first = next(&mut h.messages).await;
    let first_epoch = epoch_of(&first);

    let fake2 = FakeDaemon::start().await;
    let other2 = FakeDaemon::start().await;
    let (client2, _notifications2) = RpcClient::connect(other2.addr()).await.unwrap();
    fake2.reply_with("auth", json!({ "ok": true }));
    fake2.reply_with("events.subscribe", json!({ "subscribed": true }));
    fake2.reply_with("session.list", json!({ "sessions": [session_info("s2")] }));

    h.tx
        .send(DaemonState::Ready {
            client: client2,
            listen: fake2.addr(),
            generation: 2,
            pid: 2,
            attached: false,
        })
        .unwrap();

    let message = next(&mut h.messages).await;
    match &message {
        HubMessage::Snapshot {
            generation,
            sessions,
            ..
        } => {
            assert_eq!(*generation, 2);
            assert_eq!(sessions[0].session_id, "s2");
        }
        other => panic!("expected a snapshot, got {other:?}"),
    }
    assert!(epoch_of(&message) > first_epoch);
}

#[tokio::test]
async fn a_closed_connection_emits_unavailable() {
    let mut h = Harness::new().await;
    h.script_first_connection();
    h.ready(1, h.fake.addr()).await;
    let _snapshot = next(&mut h.messages).await;

    h.fake.close().await;
    let message = next(&mut h.messages).await;
    assert_eq!(message, HubMessage::Unavailable { generation: 1 });
}

#[tokio::test]
async fn stopped_emits_unavailable_once_and_never_reconnects() {
    let mut h = Harness::new().await;
    h.script_first_connection();
    h.ready(1, h.fake.addr()).await;
    let _snapshot = next(&mut h.messages).await;

    h.tx.send(DaemonState::Stopped).unwrap();
    assert_eq!(
        next(&mut h.messages).await,
        HubMessage::Unavailable { generation: 1 }
    );
    expect_silent(&mut h.messages, 1500).await;
}

#[tokio::test]
async fn p17_resync_relists_without_stopping_sessions() {
    let mut h = Harness::new().await;
    h.script_first_connection();
    h.ready(1, h.fake.addr()).await;
    let first = next(&mut h.messages).await;
    let first_epoch = epoch_of(&first);

    h.hub.resync();
    let second = next(&mut h.messages).await;
    assert_eq!(snapshot_ids(&second), vec!["s1"]);
    assert!(epoch_of(&second) > first_epoch);

    drop(h.hub);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let received = h.fake.received();
    assert!(
        !received
            .iter()
            .any(|request| request["method"] == "session.stop")
    );
    assert!(
        !received
            .iter()
            .any(|request| request["method"] == "events.unsubscribe")
    );
}

#[tokio::test]
async fn connect_authenticated_rejects_non_loopback_and_a_missing_token() {
    let tmp = tempfile::tempdir().unwrap();
    let non_loopback: SocketAddr = "10.0.0.1:7605".parse().unwrap();
    assert!(matches!(
        connect_authenticated(non_loopback, tmp.path()).await,
        Err(SetuError::Unauthorized)
    ));
    let loopback: SocketAddr = "127.0.0.1:7605".parse().unwrap();
    assert!(matches!(
        connect_authenticated(loopback, tmp.path()).await,
        Err(SetuError::Unauthorized)
    ));
}
