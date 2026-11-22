//! Scriptable in-process ADB server for watcher tests (TDD_TICKETS §4).
//!
//! Binds `127.0.0.1:0`, accepts connections one after another, records each
//! raw request frame, answers `OKAY` (or `FAIL` on demand), and pushes framed
//! `track-devices-l` payloads on the current connection.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{timeout, Duration};

struct State {
    requests: Mutex<Vec<String>>,
    connections: Mutex<usize>,
    disconnects: Mutex<usize>,
    fail_next: Mutex<bool>,
    write: AsyncMutex<Option<OwnedWriteHalf>>,
    /// Payloads pushed before the handshake completed, flushed after `OKAY`.
    queued: AsyncMutex<Vec<Vec<u8>>>,
}

/// A fake ADB server for a single test.
pub struct FakeAdbServer {
    addr: SocketAddr,
    state: Arc<State>,
}

impl FakeAdbServer {
    /// Bind a listener on a free loopback port and serve connections.
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback listener");
        let addr = listener.local_addr().expect("listener local addr");
        let state = Arc::new(State {
            requests: Mutex::new(Vec::new()),
            connections: Mutex::new(0),
            disconnects: Mutex::new(0),
            fail_next: Mutex::new(false),
            write: AsyncMutex::new(None),
            queued: AsyncMutex::new(Vec::new()),
        });
        tokio::spawn(accept(listener, Arc::clone(&state)));
        Self { addr, state }
    }

    /// The address the watcher should connect to.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Every request frame received so far, including the length prefix.
    pub fn requests(&self) -> Vec<String> {
        self.state
            .requests
            .lock()
            .expect("request log")
            .clone()
    }

    /// Answer the next request with `FAIL` and a framed message.
    pub fn reply_fail(&self) {
        *self.state.fail_next.lock().expect("fail flag") = true;
    }

    /// Frame and send a payload on the current connection.
    pub async fn push(&self, payload: &str) {
        let bytes = frame(payload);
        let mut queued = self.state.queued.lock().await;
        let mut write = self.state.write.lock().await;
        match write.as_mut() {
            Some(write) => {
                let _ = write.write_all(&bytes).await;
            }
            None => queued.push(bytes),
        }
    }

    /// Drop the current connection and keep listening.
    pub async fn close(&self) {
        *self.state.write.lock().await = None;
    }

    /// Wait until at least `count` connections have been accepted.
    pub async fn wait_for_connections(&self, count: usize) {
        wait_until(|| {
            *self
                .state
                .connections
                .lock()
                .expect("connection count")
                >= count
        })
        .await
        .expect("fake ADB accepted the expected connections in time");
    }

    /// Wait until at least `count` connections have closed.
    pub async fn wait_for_disconnects(&self, count: usize) {
        wait_until(|| {
            *self
                .state
                .disconnects
                .lock()
                .expect("disconnect count")
                >= count
        })
        .await
        .expect("fake ADB saw the expected disconnects in time");
    }

    /// Wait until at least `count` request frames have arrived.
    pub async fn wait_for_requests(&self, count: usize) {
        wait_until(|| self.state.requests.lock().expect("request log").len() >= count)
            .await
            .expect("fake ADB received the expected requests in time");
    }
}

fn frame(payload: &str) -> Vec<u8> {
    let mut bytes = format!("{:04x}", payload.len()).into_bytes();
    bytes.extend_from_slice(payload.as_bytes());
    bytes
}

async fn wait_until(condition: impl Fn() -> bool) -> Result<(), ()> {
    timeout(Duration::from_secs(5), async {
        loop {
            if condition() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .map_err(|_| ())
}

async fn accept(listener: TcpListener, state: Arc<State>) {
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(_) => return,
        };
        *state.connections.lock().expect("connection count") += 1;
        serve(stream, Arc::clone(&state)).await;
        *state.disconnects.lock().expect("disconnect count") += 1;
    }
}

async fn serve(stream: TcpStream, state: Arc<State>) {
    let (mut read, mut write) = stream.into_split();

    let mut length = [0u8; 4];
    if read.read_exact(&mut length).await.is_err() {
        return;
    }
    let length_text = String::from_utf8_lossy(&length).into_owned();
    let size = match usize::from_str_radix(&length_text, 16) {
        Ok(size) => size,
        Err(_) => return,
    };
    let mut payload = vec![0u8; size];
    if read.read_exact(&mut payload).await.is_err() {
        return;
    }
    let request = format!("{length_text}{}", String::from_utf8_lossy(&payload));

    let fail = {
        let mut flag = state.fail_next.lock().expect("fail flag");
        let fail = *flag;
        *flag = false;
        fail
    };

    let reply = if fail {
        let mut bytes = b"FAIL".to_vec();
        bytes.extend_from_slice(&frame("device offline"));
        bytes
    } else {
        b"OKAY".to_vec()
    };
    if write.write_all(&reply).await.is_err() {
        return;
    }
    state
        .requests
        .lock()
        .expect("request log")
        .push(request);
    if fail {
        return;
    }

    {
        let mut queued = state.queued.lock().await;
        for bytes in queued.drain(..) {
            let _ = write.write_all(&bytes).await;
        }
    }
    *state.write.lock().await = Some(write);

    // Keep the connection until the client closes it.
    let mut discard = [0u8; 1024];
    loop {
        match read.read(&mut discard).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }
    *state.write.lock().await = None;
}
