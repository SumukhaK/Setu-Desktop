//! A reconnecting watcher for `host:track-devices-l`.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::watch;

use crate::adb::protocol::{encode_request, parse_device_list, FrameReader};

const BACKOFF_START: Duration = Duration::from_millis(500);
const BACKOFF_MAX: Duration = Duration::from_secs(5);
const CHUNK_SIZE: usize = 4096;

#[derive(Clone, Serialize, PartialEq, Debug)]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "server", rename_all = "snake_case")]
pub enum AdbSnapshot {
    Unknown,
    Down,
    Up { devices: Vec<AdbDevice> },
}

struct Inner {
    shutdown: watch::Sender<bool>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

/// Keeps the watcher task alive. Dropping every handle ends the task.
#[derive(Clone)]
pub struct AdbWatcher {
    _inner: Arc<Inner>,
}

pub fn start(server: SocketAddr) -> (AdbWatcher, watch::Receiver<AdbSnapshot>) {
    let (snapshots, receiver) = watch::channel(AdbSnapshot::Unknown);
    let (shutdown, shutdown_receiver) = watch::channel(false);
    tokio::spawn(run(server, snapshots, shutdown_receiver));

    (
        AdbWatcher {
            _inner: Arc::new(Inner { shutdown }),
        },
        receiver,
    )
}

async fn run(
    server: SocketAddr,
    snapshots: watch::Sender<AdbSnapshot>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut backoff = BACKOFF_START;

    loop {
        if *shutdown.borrow() {
            return;
        }

        let handshake = tokio::select! {
            _ = wait_for_shutdown(&mut shutdown) => return,
            handshake = track_once(server, &snapshots) => handshake,
        };

        if handshake {
            backoff = BACKOFF_START;
        }
        if *shutdown.borrow() {
            return;
        }

        tokio::select! {
            _ = wait_for_shutdown(&mut shutdown) => return,
            _ = tokio::time::sleep(backoff) => {}
        }
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}

async fn wait_for_shutdown(shutdown: &mut watch::Receiver<bool>) {
    if *shutdown.borrow_and_update() {
        return;
    }
    let _ = shutdown.changed().await;
}

/// One connection's lifetime. Returns true once the `OKAY` handshake passed.
async fn track_once(server: SocketAddr, snapshots: &watch::Sender<AdbSnapshot>) -> bool {
    let mut stream = match TcpStream::connect(server).await {
        Ok(stream) => stream,
        Err(_) => {
            publish_down(snapshots);
            return false;
        }
    };

    if stream
        .write_all(&encode_request("host:track-devices-l"))
        .await
        .is_err()
    {
        publish_down(snapshots);
        return false;
    }

    let mut status = [0u8; 4];
    if stream.read_exact(&mut status).await.is_err() || &status != b"OKAY" {
        publish_down(snapshots);
        return false;
    }

    let mut reader = FrameReader::new();
    let mut chunk = [0u8; CHUNK_SIZE];
    loop {
        match stream.read(&mut chunk).await {
            Ok(0) => {
                publish_down(snapshots);
                return true;
            }
            Ok(read) => match reader.feed(&chunk[..read]) {
                Ok(payloads) => {
                    for payload in payloads {
                        publish_up(snapshots, parse_device_list(&payload));
                    }
                }
                Err(_) => {
                    publish_down(snapshots);
                    return true;
                }
            },
            Err(_) => {
                publish_down(snapshots);
                return true;
            }
        }
    }
}

fn publish_down(snapshots: &watch::Sender<AdbSnapshot>) {
    snapshots.send_if_modified(|current| {
        if *current == AdbSnapshot::Down {
            return false;
        }
        *current = AdbSnapshot::Down;
        true
    });
}

fn publish_up(snapshots: &watch::Sender<AdbSnapshot>, devices: Vec<AdbDevice>) {
    let next = AdbSnapshot::Up { devices };
    snapshots.send_if_modified(|current| {
        if *current == next {
            return false;
        }
        *current = next;
        true
    });
}
