//! DT-05 watcher integration tests (P09) against `FakeAdbServer`.

#[path = "support/fake_adb_server.rs"]
mod fake_adb_server;

use std::time::{Duration, Instant};

use fake_adb_server::FakeAdbServer;
use setu_desktop::adb::{start, AdbDevice, AdbSnapshot};
use tokio::sync::watch;
use tokio::time::timeout;

async fn next(rx: &mut watch::Receiver<AdbSnapshot>) -> AdbSnapshot {
    timeout(Duration::from_secs(5), rx.changed())
        .await
        .expect("watcher published a snapshot")
        .expect("watcher is still running");
    rx.borrow_and_update().clone()
}

fn device(serial: &str, state: &str) -> AdbDevice {
    AdbDevice {
        serial: serial.to_owned(),
        state: state.to_owned(),
    }
}

fn up(devices: Vec<AdbDevice>) -> AdbSnapshot {
    AdbSnapshot::Up { devices }
}

#[tokio::test]
async fn sends_the_exact_track_devices_l_frame() {
    let server = FakeAdbServer::start().await;
    let (_watcher, _rx) = start(server.addr());

    server.wait_for_connections(1).await;
    server.wait_for_requests(1).await;

    assert_eq!(
        server.requests(),
        vec!["0014host:track-devices-l".to_owned()]
    );
}

#[tokio::test]
async fn p09_publishes_unauthorized_offline_and_device_in_order() {
    let server = FakeAdbServer::start().await;
    let (_watcher, mut rx) = start(server.addr());
    server.wait_for_requests(1).await;

    server.push("").await;
    assert_eq!(next(&mut rx).await, up(Vec::new()));

    server.push("127.0.0.1:41377\tunauthorized\n").await;
    assert_eq!(
        next(&mut rx).await,
        up(vec![device("127.0.0.1:41377", "unauthorized")])
    );

    server.push("127.0.0.1:41377\toffline\n").await;
    assert_eq!(
        next(&mut rx).await,
        up(vec![device("127.0.0.1:41377", "offline")])
    );

    server.push("127.0.0.1:41377\tdevice\n").await;
    assert_eq!(
        next(&mut rx).await,
        up(vec![device("127.0.0.1:41377", "device")])
    );

    server.push("127.0.0.1:41377\tdevice\n").await;
    assert!(
        timeout(Duration::from_millis(200), rx.changed())
            .await
            .is_err(),
        "an identical payload must not wake the UI"
    );
}

#[tokio::test]
async fn keeps_neighbour_serials_separate() {
    let server = FakeAdbServer::start().await;
    let (_watcher, mut rx) = start(server.addr());
    server.wait_for_requests(1).await;

    server
        .push("127.0.0.1:4137 device\n127.0.0.1:413770 device\n127.0.0.1:41377 device\n")
        .await;

    assert_eq!(
        next(&mut rx).await,
        up(vec![
            device("127.0.0.1:4137", "device"),
            device("127.0.0.1:41377", "device"),
            device("127.0.0.1:413770", "device"),
        ])
    );
}

#[tokio::test]
async fn fail_leads_to_down() {
    let server = FakeAdbServer::start().await;
    server.reply_fail();
    let (_watcher, mut rx) = start(server.addr());

    assert_eq!(next(&mut rx).await, AdbSnapshot::Down);
}

#[tokio::test]
async fn reconnects_after_the_server_closes() {
    let server = FakeAdbServer::start().await;
    let (_watcher, mut rx) = start(server.addr());
    server.wait_for_requests(1).await;

    server.push("127.0.0.1:41377 device\n").await;
    assert_eq!(
        next(&mut rx).await,
        up(vec![device("127.0.0.1:41377", "device")])
    );

    server.close().await;
    assert_eq!(next(&mut rx).await, AdbSnapshot::Down);

    server.push("127.0.0.1:41377 device\n").await;
    let started = Instant::now();
    assert_eq!(
        next(&mut rx).await,
        up(vec![device("127.0.0.1:41377", "device")])
    );
    assert!(
        started.elapsed() < Duration::from_millis(1500),
        "the watcher must reconnect within 1.5 s"
    );
}

#[tokio::test]
async fn reports_down_when_nothing_is_listening() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a free port");
    let addr = listener.local_addr().expect("local addr");
    drop(listener);

    let (_watcher, mut rx) = start(addr);

    assert_eq!(next(&mut rx).await, AdbSnapshot::Down);
}

#[tokio::test]
async fn dropping_the_watcher_closes_the_connection() {
    let server = FakeAdbServer::start().await;
    let (watcher, _rx) = start(server.addr());
    server.wait_for_requests(1).await;

    drop(watcher);

    server.wait_for_disconnects(1).await;
}
