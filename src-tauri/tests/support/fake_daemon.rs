//! Scriptable in-process JSON-RPC 2.0 line server for tests (TDD_TICKETS §4).
//!
//! Binds `127.0.0.1:0`, serves one client connection, records every request
//! it receives, and replays scripted replies per method in the order the
//! test queued them. Replies, notifications and raw bytes are written
//! through one write half, so frames are never interleaved.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::Duration;

/// One scripted reply: a result or an error object, sent after an optional delay.
struct Scripted {
    result: Option<Value>,
    error: Option<Value>,
    delay: Option<Duration>,
}

struct State {
    scripts: Mutex<HashMap<String, Vec<Scripted>>>,
    received: Mutex<Vec<Value>>,
    write: AsyncMutex<Option<OwnedWriteHalf>>,
}

/// A fake daemon connection for a single test.
pub struct FakeDaemon {
    addr: SocketAddr,
    state: Arc<State>,
}

impl FakeDaemon {
    /// Bind a listener on a free loopback port and serve its first connection.
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback listener");
        let addr = listener.local_addr().expect("listener local addr");
        let state = Arc::new(State {
            scripts: Mutex::new(HashMap::new()),
            received: Mutex::new(Vec::new()),
            write: AsyncMutex::new(None),
        });
        tokio::spawn(serve(listener, Arc::clone(&state)));
        Self { addr, state }
    }

    /// The address the client should connect to.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Every request received so far, as parsed JSON-RPC request objects.
    pub fn received(&self) -> Vec<Value> {
        self.state.received.lock().expect("received log").clone()
    }

    /// Reply to the next request with this method using its own id.
    pub fn reply_with(&self, method: &str, result: Value) {
        self.push(
            method,
            Scripted {
                result: Some(result),
                error: None,
                delay: None,
            },
        );
    }

    /// Reply to the next request with this method with a JSON-RPC error object.
    pub fn reply_with_error(&self, method: &str, error: Value) {
        self.push(
            method,
            Scripted {
                result: None,
                error: Some(error),
                delay: None,
            },
        );
    }

    /// Reply to the next request with this method after a delay.
    pub fn reply_delayed(&self, method: &str, result: Value, delay: Duration) {
        self.push(
            method,
            Scripted {
                result: Some(result),
                error: None,
                delay: Some(delay),
            },
        );
    }

    fn push(&self, method: &str, scripted: Scripted) {
        self.state
            .scripts
            .lock()
            .expect("script queues")
            .entry(method.to_owned())
            .or_default()
            .push(scripted);
    }

    /// Push a notification to the client.
    pub async fn notify(&self, method: &str, params: Value) {
        let mut bytes = json!({ "jsonrpc": "2.0", "method": method, "params": params })
            .to_string()
            .into_bytes();
        bytes.push(b'\n');
        self.write_frame(bytes).await;
    }

    /// Send raw bytes, unframed: for split lines and oversize lines.
    pub async fn send_raw(&self, bytes: &[u8]) {
        self.write_frame(bytes.to_vec()).await;
    }

    /// Close the connection: the client sees EOF (AD-3).
    pub async fn close(&self) {
        *self.state.write.lock().await = None;
    }

    async fn write_frame(&self, bytes: Vec<u8>) {
        let mut write = self.state.write.lock().await;
        if let Some(write) = write.as_mut() {
            let _ = write.write_all(&bytes).await;
        }
    }
}

/// Accept one connection and serve it until the client goes away.
async fn serve(listener: TcpListener, state: Arc<State>) {
    let (stream, _) = match listener.accept().await {
        Ok(accepted) => accepted,
        Err(_) => return,
    };
    let (read_half, write_half) = stream.into_split();
    *state.write.lock().await = Some(write_half);
    let mut reader = BufReader::new(read_half);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let request: Value = match serde_json::from_str(trimmed) {
                    Ok(request) => request,
                    Err(_) => continue,
                };
                state
                    .received
                    .lock()
                    .expect("received log")
                    .push(request.clone());
                tokio::spawn(handle(Arc::clone(&state), request));
            }
        }
    }
}

/// Replay the next scripted entry for a request, or answer method-not-found.
async fn handle(state: Arc<State>, request: Value) {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let scripted = state
        .scripts
        .lock()
        .expect("script queues")
        .get_mut(&method)
        .and_then(|queue| {
            if queue.is_empty() {
                None
            } else {
                Some(queue.remove(0))
            }
        });
    let reply = match scripted {
        Some(scripted) => {
            if let Some(delay) = scripted.delay {
                tokio::time::sleep(delay).await;
            }
            match (scripted.result, scripted.error) {
                (Some(result), _) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                (None, Some(error)) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
                (None, None) => return,
            }
        }
        None => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32601, "message": "method not found" }
        }),
    };
    let mut bytes = reply.to_string().into_bytes();
    bytes.push(b'\n');
    let mut write = state.write.lock().await;
    if let Some(write) = write.as_mut() {
        let _ = write.write_all(&bytes).await;
    }
}
