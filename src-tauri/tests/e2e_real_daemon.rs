//! Real-SDK smoke test. It needs SETU_E2E_BIN_DIR with `setu` and
//! `setu-daemon` built from Setu-SDK v1.1.0; otherwise it reports a skip.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use setu_desktop::commands::session::{connect_with_device, stop_session, StopOutcome};
use setu_desktop::commands::{
    connect_with_code, forget_device, list_devices, set_nickname, ConnectOutcome, ForgetOutcome,
    ListOutcome, NicknameOutcome, PendingConnect,
};
use setu_desktop::daemon::{DaemonConfig, DaemonState, Supervisor, SupervisorOptions, Workspace};
use setu_desktop::events::{self, HubEvent, HubMessage};
use setu_desktop::rpc::RpcClient;
use setu_desktop::store::nicknames::NicknameStore;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream as AsyncTcpStream;
use tokio::sync::mpsc;
use tokio::time::timeout;

const STEP: Duration = Duration::from_secs(15);
const WHOLE: Duration = Duration::from_secs(55);

fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind a free loopback port");
    let port = listener.local_addr().expect("listener address").port();
    drop(listener);
    port
}

/// Kills the child on every exit path, including a panic.
struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Echoes every 24-byte frame the agent sends through the ADB tunnel.
fn start_echo() -> (SocketAddr, std::sync::mpsc::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind echo server");
    let addr = listener.local_addr().expect("echo address");
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            let Ok(mut stream) = stream else {
                break;
            };
            std::thread::spawn(move || loop {
                let mut frame = [0u8; 24];
                if stream.read_exact(&mut frame).is_err() || stream.write_all(&frame).is_err() {
                    break;
                }
            });
        }
    });

    (addr, stop_tx)
}

fn start_relay(bin_dir: &Path, port: u16, state: &Path) -> ChildGuard {
    let args = [
        "relay",
        "--listen",
        &format!("127.0.0.1:{port}"),
        "--state",
        state.to_str().expect("utf-8 state path"),
    ];
    let child = Command::new(bin_dir.join("setu"))
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("start setu relay");
    ChildGuard(child)
}

fn start_device(
    bin_dir: &Path,
    relay_port: u16,
    echo_port: u16,
    state: &Path,
) -> (ChildGuard, std::sync::mpsc::Receiver<(String, String)>) {
    let args = [
        "device",
        "--relay",
        &format!("127.0.0.1:{relay_port}"),
        "--adbd",
        &format!("127.0.0.1:{echo_port}"),
        "--name",
        "phone",
        "--state",
        state.to_str().expect("utf-8 state path"),
    ];
    let mut child = Command::new(bin_dir.join("setu"))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("start setu device agent");
    let stdout = child.stdout.take().expect("agent stdout");
    let (code_tx, code_rx) = std::sync::mpsc::channel::<(String, String)>();

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            println!("agent: {line}");
            let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if event.get("event").and_then(|value| value.as_str()) != Some("pairing_code") {
                continue;
            }
            let code = event.get("code").and_then(|value| value.as_str());
            let device_id = event.get("device_id").and_then(|value| value.as_str());
            if let (Some(code), Some(device_id)) = (code, device_id) {
                let _ = code_tx.send((code.to_owned(), device_id.to_owned()));
                break;
            }
        }
    });

    (ChildGuard(child), code_rx)
}

fn ready_client(supervisor: &Supervisor) -> Option<RpcClient> {
    match &*supervisor.subscribe().borrow() {
        DaemonState::Ready { client, .. } => Some(client.clone()),
        _ => None,
    }
}

async fn next_hub(rx: &mut mpsc::UnboundedReceiver<HubMessage>) -> HubMessage {
    timeout(STEP, rx.recv())
        .await
        .expect("a hub message in time")
        .expect("the hub channel is open")
}

fn cnxn_header() -> [u8; 24] {
    let words: [u32; 6] = [
        0x4e58_4e43,
        0x0100_0000,
        4096,
        0,
        0,
        0x4e58_4e43 ^ 0xffff_ffff,
    ];
    let mut header = [0u8; 24];
    for (index, word) in words.iter().enumerate() {
        header[index * 4..index * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    header
}

async fn roundtrip(addr: SocketAddr) {
    let mut stream = timeout(STEP, AsyncTcpStream::connect(addr))
        .await
        .expect("connect to the local ADB endpoint")
        .expect("local ADB endpoint accepts connections");
    let header = cnxn_header();
    timeout(STEP, stream.write_all(&header))
        .await
        .expect("write the CNXN header")
        .expect("header was written");
    let mut reply = [0u8; 24];
    timeout(STEP, stream.read_exact(&mut reply))
        .await
        .expect("read the echoed header")
        .expect("header was read");
    assert_eq!(reply, header, "the tunnel must echo the 24-byte header");
}

#[tokio::test(flavor = "multi_thread")]
async fn real_daemon_smoke_test() {
    let Ok(bin_dir) = std::env::var("SETU_E2E_BIN_DIR") else {
        println!("SETU_E2E_BIN_DIR not set; skipping real-daemon smoke test");
        return;
    };
    timeout(WHOLE, run(PathBuf::from(bin_dir)))
        .await
        .expect("the smoke test finishes in under 55 seconds");
}

async fn run(bin_dir: PathBuf) {
    let tmp = TempDir::new().expect("a temporary workspace");
    let relay_port = free_port();
    let (echo_addr, echo_stop) = start_echo();
    let relay_state = tmp.path().join("relay");
    let device_state = tmp.path().join("device");
    std::fs::create_dir_all(&relay_state).expect("relay state dir");
    std::fs::create_dir_all(&device_state).expect("device state dir");

    let mut relay = Some(start_relay(&bin_dir, relay_port, &relay_state));
    let (device, code_rx) = start_device(&bin_dir, relay_port, echo_addr.port(), &device_state);
    let (code, device_id) = timeout(
        Duration::from_secs(10),
        tokio::task::spawn_blocking(move || code_rx.recv()),
    )
    .await
    .expect("a pairing code from the phone agent")
    .expect("the agent stdout channel is open")
    .expect("a code and device id");

    let app_data = tmp.path().join("appdata");
    let config = DaemonConfig {
        daemon_path: bin_dir.join("setu-daemon"),
        relay: format!("127.0.0.1:{relay_port}"),
        label: Some("e2e".to_owned()),
        adb_path: None,
        relay_pin: None,
        proxy: None,
        corporate: None,
    };
    let supervisor = Supervisor::start(
        Workspace::Solo,
        app_data.clone(),
        config,
        SupervisorOptions::default(),
    );
    let mut states = supervisor.subscribe();
    timeout(STEP, async {
        loop {
            if matches!(&*states.borrow_and_update(), DaemonState::Ready { .. }) {
                break;
            }
            states.changed().await.expect("the supervisor is alive");
        }
    })
    .await
    .expect("the daemon reaches Ready");

    let (_hub, mut messages) =
        events::start(supervisor.subscribe(), Workspace::Solo.state_dir(&app_data));
    match next_hub(&mut messages).await {
        HubMessage::Snapshot { sessions, .. } => {
            assert!(sessions.is_empty(), "a fresh daemon has no sessions");
        }
        other => panic!("expected the first snapshot, got {other:?}"),
    }

    let pending = PendingConnect::default();
    let outcome = timeout(
        STEP,
        connect_with_code(ready_client(&supervisor), &code, &pending),
    )
    .await
    .expect("pairing finishes");
    println!("pairing outcome: {outcome:?}");
    let (session_id, addr) = match outcome {
        ConnectOutcome::Connected {
            session_id,
            adb_addr,
            ..
        } => {
            let addr = adb_addr
                .parse::<SocketAddr>()
                .expect("a loopback ADB endpoint");
            assert!(addr.ip().is_loopback());
            (session_id, addr)
        }
        other => panic!("expected Connected, got {other:?}"),
    };

    let mut seen = std::collections::HashSet::new();
    timeout(STEP, async {
        while seen.len() < 2 {
            match next_hub(&mut messages).await {
                HubMessage::Event {
                    event: HubEvent::Listening { session, .. },
                    ..
                } if session == session_id => {
                    seen.insert("listening");
                }
                HubMessage::Event {
                    event: HubEvent::SessionUp { session, .. },
                    ..
                } if session == session_id => {
                    seen.insert("session_up");
                }
                _ => {}
            }
        }
    })
    .await
    .expect("Listening and SessionUp for the paired session");

    roundtrip(addr).await;

    // The relay disappears for four seconds, then returns on the same port.
    relay.take().expect("a running relay");
    tokio::time::sleep(Duration::from_secs(4)).await;
    let _relay_after_outage = start_relay(&bin_dir, relay_port, &relay_state);

    let mut down_tunnel: Option<String> = None;
    timeout(Duration::from_secs(20), async {
        loop {
            match next_hub(&mut messages).await {
                HubMessage::Event {
                    event: HubEvent::PathDown { tunnel_id, .. },
                    ..
                } => {
                    if down_tunnel.is_none() {
                        down_tunnel = Some(tunnel_id);
                    }
                }
                HubMessage::Event {
                    event:
                        HubEvent::PathUp {
                            tunnel_id,
                            transport,
                            ..
                        },
                    ..
                } if down_tunnel.as_deref() == Some(tunnel_id.as_str()) => {
                    assert_eq!(transport, "relay-tcp", "the path rejoined over TCP");
                    break;
                }
                _ => {}
            }
        }
    })
    .await
    .expect("PathDown then PathUp on one tunnel id");
    roundtrip(addr).await;

    let stopped = timeout(STEP, stop_session(ready_client(&supervisor), &session_id))
        .await
        .expect("session.stop finishes");
    assert_eq!(stopped, StopOutcome::Stopped);
    timeout(Duration::from_secs(5), async {
        loop {
            if let HubMessage::Event {
                event: HubEvent::SessionDown { session, abnormal },
                ..
            } = next_hub(&mut messages).await
            {
                if session == session_id {
                    assert!(!abnormal, "a normal stop is not abnormal");
                    break;
                }
            }
        }
    })
    .await
    .expect("SessionDown for the stopped session");

    let store = NicknameStore::new(&Workspace::Solo.state_dir(&app_data));
    assert_eq!(
        set_nickname(&store, &device_id, "  E2E "),
        NicknameOutcome::Saved {
            nickname: Some("E2E".to_owned())
        }
    );
    match timeout(STEP, list_devices(ready_client(&supervisor), &store))
        .await
        .expect("devices.list finishes")
    {
        ListOutcome::Listed { devices } => {
            assert_eq!(devices.len(), 1, "one pinned device");
            assert_eq!(devices[0].device_id, device_id);
            assert_eq!(devices[0].nickname.as_deref(), Some("E2E"));
        }
        other => panic!("expected Listed, got {other:?}"),
    }

    let pending = PendingConnect::default();
    let second = timeout(
        STEP,
        connect_with_device(ready_client(&supervisor), &device_id, &pending),
    )
    .await
    .expect("device connect finishes");
    let second_id = match second {
        ConnectOutcome::Connected { session_id, .. } => session_id,
        other => panic!("expected Connected by device, got {other:?}"),
    };
    assert_eq!(
        timeout(STEP, stop_session(ready_client(&supervisor), &second_id))
            .await
            .expect("second stop finishes"),
        StopOutcome::Stopped
    );

    assert_eq!(
        timeout(
            STEP,
            forget_device(ready_client(&supervisor), &device_id, &store)
        )
        .await
        .expect("forget finishes"),
        ForgetOutcome::Forgotten
    );
    assert_eq!(
        timeout(
            STEP,
            forget_device(ready_client(&supervisor), &device_id, &store)
        )
        .await
        .expect("second forget finishes"),
        ForgetOutcome::NotPaired
    );
    match timeout(STEP, list_devices(ready_client(&supervisor), &store))
        .await
        .expect("devices.list after forget finishes")
    {
        ListOutcome::Listed { devices } => assert!(devices.is_empty()),
        other => panic!("expected an empty Listed, got {other:?}"),
    }
    let pending = PendingConnect::default();
    assert_eq!(
        timeout(
            STEP,
            connect_with_device(ready_client(&supervisor), &device_id, &pending),
        )
        .await
        .expect("connect after forget finishes"),
        ConnectOutcome::NotPaired
    );

    supervisor.stop().await;
    let _ = echo_stop.send(());
    drop(device);
}
