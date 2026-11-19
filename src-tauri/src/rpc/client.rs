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
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
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
        let stream = TcpStream::connect(addr).await.map_err(SetuError::Io)?;
        let (read_half, write_half) = stream.into_split();
        let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel();
        let (notifications_tx, notifications_rx) = mpsc::unbounded_channel();
        let shared = Arc::new(Shared {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            outgoing: Mutex::new(Some(outgoing_tx)),
        });
        tokio::spawn(run_connection(
            read_half,
            write_half,
            outgoing_rx,
            notifications_tx,
            Arc::clone(&shared),
        ));
        Ok((Self { shared }, notifications_rx))
    }

    /// Send one request and await its response.
    ///
    /// On `-32027 busy` the request is retried once after [`BUSY_RETRY_DELAY`]
    /// with a new id; a second busy is returned to the caller (AD-4).
    pub async fn call(&self, method: &str, params: Option<Value>) -> Result<Value, SetuError> {
        let first = self.request_once(method, params.clone()).await;
        match first {
            Err(SetuError::Busy) => {}
            other => return other,
        }
        tokio::time::sleep(BUSY_RETRY_DELAY).await;
        self.request_once(method, params).await
    }

    /// Typed `auth {token}` call; expects `{ok: true}`.
    pub async fn auth(&self, token: &str) -> Result<(), SetuError> {
        let result = self.call("auth", Some(json!({ "token": token }))).await?;
        match result.get("ok") {
            Some(Value::Bool(true)) => Ok(()),
            _ => Err(SetuError::UnexpectedResult),
        }
    }

    /// Typed `version` call.
    pub async fn version(&self) -> Result<VersionInfo, SetuError> {
        let result = self.call("version", None).await?;
        serde_json::from_value(result).map_err(|_| SetuError::UnexpectedResult)
    }

    async fn request_once(&self, method: &str, params: Option<Value>) -> Result<Value, SetuError> {
        let id = self.shared.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply_tx, reply_rx) = oneshot::channel();
        {
            let mut pending = self.shared.pending.lock().expect("pending calls");
            if self
                .shared
                .outgoing
                .lock()
                .expect("outgoing queue")
                .is_none()
            {
                return Err(SetuError::Disconnected);
            }
            pending.insert(id, reply_tx);
        }
        let mut request = json!({ "jsonrpc": "2.0", "id": id, "method": method });
        if let Some(params) = params {
            request["params"] = params;
        }
        let frame = match encode(&request) {
            Ok(frame) => frame,
            Err(error) => {
                self.shared
                    .pending
                    .lock()
                    .expect("pending calls")
                    .remove(&id);
                return Err(error);
            }
        };
        let sent = self
            .shared
            .outgoing
            .lock()
            .expect("outgoing queue")
            .as_ref()
            .map(|outgoing| outgoing.send(frame));
        match sent {
            Some(Ok(())) => {}
            // The queue is gone or the write half failed: the connection is closed.
            _ => {
                self.shared.close();
                return Err(SetuError::Disconnected);
            }
        }
        match reply_rx.await {
            Ok(reply) => reply,
            // The pending entry was dropped by close(): the connection is closed.
            Err(_) => Err(SetuError::Disconnected),
        }
    }
}

impl Shared {
    /// Close the connection (AD-3): stop accepting writes and fail every
    /// pending call with `Disconnected`. Idempotent.
    fn close(&self) {
        let _ = self.outgoing.lock().expect("outgoing queue").take();
        let mut pending = self.pending.lock().expect("pending calls");
        for (_, reply_tx) in pending.drain() {
            let _ = reply_tx.send(Err(SetuError::Disconnected));
        }
    }
}

/// Own the socket for one connection until it is closed (AD-3).
///
/// Reads run between serialized writes; either direction failing — EOF,
/// an oversize or unparseable frame, a write error, or a closed outgoing
/// queue — ends the task, which closes the connection, fails every pending
/// call with `Disconnected` and drops the notification sender, ending the
/// notification channel. Reconnecting is DT-02's job.
async fn run_connection(
    mut read_half: OwnedReadHalf,
    mut write_half: OwnedWriteHalf,
    mut outgoing: mpsc::UnboundedReceiver<Vec<u8>>,
    notifications: mpsc::UnboundedSender<Notification>,
    shared: Arc<Shared>,
) {
    let mut decoder = LineDecoder::new();
    let mut buffer = vec![0u8; READ_BUFFER_BYTES];
    loop {
        tokio::select! {
            read = read_half.read(&mut buffer) => match read {
                Ok(0) => break,
                Ok(n) => match decoder.feed(&buffer[..n]) {
                    Ok(lines) => {
                        let mut violated = false;
                        for line in lines {
                            match serde_json::from_slice::<Value>(&line) {
                                Ok(message) => dispatch(message, &shared, &notifications),
                                Err(_) => {
                                    violated = true;
                                    break;
                                }
                            }
                        }
                        if violated {
                            break;
                        }
                    }
                    Err(_) => break,
                },
                Err(_) => break,
            },
            frame = outgoing.recv() => match frame {
                Some(frame) => {
                    if write_half.write_all(&frame).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
        }
    }
    shared.close();
}

/// Route one inbound JSON-RPC message to its pending call or the
/// notification channel.
fn dispatch(message: Value, shared: &Shared, notifications: &mpsc::UnboundedSender<Notification>) {
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        // A response: match it to the pending call with this id.
        let pending = shared.pending.lock().expect("pending calls").remove(&id);
        if let Some(reply_tx) = pending {
            let reply = match message.get("error") {
                Some(error) => Err(from_error_object(error)),
                None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
            };
            let _ = reply_tx.send(reply);
        }
        // A response with an unknown id is ignored.
        return;
    }
    if let Some(method) = message.get("method").and_then(Value::as_str) {
        let _ = notifications.send(Notification {
            method: method.to_owned(),
            params: message.get("params").cloned().unwrap_or(Value::Null),
        });
    }
}
