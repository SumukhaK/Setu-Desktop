//! `RpcClient` over a loopback TCP connection to `setu-daemon` (AD-1..AD-5).
//!
//! One connection task reads responses and notifications and performs the
//! serialized writes. Calls are matched to responses by unique per-connection
//! id, so out-of-order replies resolve the right caller.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};

use super::errors::{from_error_object, SetuError};
use super::framing::{encode, LineDecoder};

/// Backoff before the single internal retry of a `-32027 busy` reply (AD-4).
const BUSY_RETRY_DELAY: Duration = Duration::from_millis(100);

/// Size of the read buffer used by the connection task.
const READ_BUFFER_BYTES: usize = 64 * 1024;

/// A notification pushed by the daemon: `event` and `events.dropped` pass
/// through raw; DT-03 types them.
pub struct Notification {
    pub method: String,
    pub params: Value,
}

/// Result of the typed `version` helper.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct VersionInfo {
    pub version: String,
    pub mode: String,
    pub audit: bool,
}

/// A shared handle to one daemon connection. Clone freely; calls may be
/// in flight concurrently.
#[derive(Clone)]
pub struct RpcClient {
    shared: Arc<Shared>,
}

struct Shared {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, SetuError>>>>,
    outgoing: Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>,
}

impl RpcClient {
    /// Connect to the daemon and start the connection task.
    ///
    /// Returns the client handle and the channel on which the daemon's
    /// notifications arrive, in arrival order.
    pub async fn connect(
        addr: SocketAddr,
    ) -> Result<(RpcClient, mpsc::UnboundedReceiver<Notification>), SetuError> {
        todo!("dial, spawn the connection task")
    }

    /// Send one request and await its response.
    ///
    /// On `-32027 busy` the request is retried once after [`BUSY_RETRY_DELAY`]
    /// with a new id; a second busy is returned to the caller (AD-4).
    pub async fn call(&self, method: &str, params: Option<Value>) -> Result<Value, SetuError> {
        todo!("allocate id, register pending, write frame, await reply, one busy retry")
    }

    /// Typed `auth {token}` call; expects `{ok: true}`.
    pub async fn auth(&self, token: &str) -> Result<(), SetuError> {
        todo!("call auth, check the ok flag")
    }

    /// Typed `version` call.
    pub async fn version(&self) -> Result<VersionInfo, SetuError> {
        todo!("call version, parse the typed shape")
    }
}

impl Shared {
    /// Close the connection (AD-3): stop accepting writes and fail every
    /// pending call with `Disconnected`. Idempotent.
    fn close(&self) {
        todo!("drop the outgoing queue, drain the pending map with Disconnected")
    }
}
