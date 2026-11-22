//! A reconnecting watcher for `host:track-devices-l`.

use std::net::SocketAddr;

use serde::Serialize;
use tokio::sync::watch;

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

/// Keeps the watcher task alive. Dropping every handle ends the task.
#[derive(Clone)]
pub struct AdbWatcher;

pub fn start(_server: SocketAddr) -> (AdbWatcher, watch::Receiver<AdbSnapshot>) {
    todo!()
}
