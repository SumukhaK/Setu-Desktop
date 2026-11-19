//! Test-only stand-in for `setu-daemon` v1.1.0 (built as `fake-setu-daemon`).
//!
//! Accepts the real flags (ignoring unknown ones), binds `--listen`, writes
//! a random token to `<state>/daemon.token` unless one exists, prints
//! exactly one `daemon_ready` line, and serves newline JSON-RPC with `auth`
//! required first. Env knobs for tests only:
//! - `FAKE_DAEMON_EXIT_AFTER_MS`: exit with code 1 after N ms, on the first
//!   run of a state dir only (a marker file in the state dir makes later
//!   runs keep running),
//! - `FAKE_DAEMON_NO_READY=1`: bind but never print the ready line,
//! - `FAKE_DAEMON_ARGS_FILE=<path>`: append this run's argv as one JSON line.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

/// Entropy without extra crates: enough for a test fake (the real daemon
/// uses crypto/rand and needs much more care).
fn random_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let mut state = nanos.as_nanos() as u64 ^ ((std::process::id() as u64) << 32) ^ 0x9e3779b9;
    let mut token = String::new();
    for _ in 0..8 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        token.push_str(&format!("{state:016x}"));
    }
    token
}

fn record_argv(args: &[String]) {
    if let Ok(path) = std::env::var("FAKE_DAEMON_ARGS_FILE") {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            if let Ok(line) = serde_json::to_string(args) {
                let _ = writeln!(file, "{line}");
            }
        }
    }
}

/// Exit once per state dir, so a supervisor restart reaches a second run.
fn schedule_exit_once(state: &Path) {
    let Ok(ms) = std::env::var("FAKE_DAEMON_EXIT_AFTER_MS") else {
        return;
    };
    let marker = state.join("fake-exit-once.marker");
    if marker.exists() {
        return;
    }
    let _ = std::fs::write(&marker, b"");
    if let Ok(ms) = ms.parse::<u64>() {
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(ms)).await;
            std::process::exit(1);
        });
    }
}

fn ready_line(listen: &str, token_file: &Path) -> Value {
    json!({
        "event": "daemon_ready",
        "listen": listen,
        "version": "1.1.0",
        "token_file": token_file.to_string_lossy(),
        "pid": std::process::id(),
    })
}

/// Serve one connection: `auth` first (wrong or missing auth → `-32001`),
/// then `version`, `session.list`; unknown methods → `-32601`.
async fn handle_conn(socket: TcpStream, token: String) {
    let (read_half, mut write_half) = socket.into_split();
    let mut reader = BufReader::new(read_half);
    let mut authenticated = false;
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Ok(request) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        let Some(id) = request.get("id").cloned() else {
            continue;
        }; // notification
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let params_token = request
            .get("params")
            .and_then(|p| p.get("token"))
            .and_then(Value::as_str);
        let response = if !authenticated {
            if method == "auth" && params_token == Some(token.as_str()) {
                authenticated = true;
                json!({ "jsonrpc": "2.0", "id": id, "result": { "ok": true } })
            } else {
                json!({
                    "jsonrpc": "2.0", "id": id,
                    "error": { "code": -32001, "message": "call auth first" }
                })
            }
        } else {
            match method {
                "auth" => json!({ "jsonrpc": "2.0", "id": id, "result": { "ok": true } }),
                "version" => json!({
                    "jsonrpc": "2.0", "id": id,
                    "result": { "version": "1.1.0", "mode": "solo", "audit": false }
                }),
                "session.list" => json!({
                    "jsonrpc": "2.0", "id": id, "result": { "sessions": [] }
                }),
                _ => json!({
                    "jsonrpc": "2.0", "id": id,
                    "error": { "code": -32601, "message": "method not found" }
                }),
            }
        };
        let frame = setu_desktop::rpc::encode(&response).expect("response encodes");
        if write_half.write_all(&frame).await.is_err() {
            break;
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    record_argv(&args);
    let listen = arg_value(&args, "--listen").unwrap_or_else(|| "127.0.0.1:0".into());
    let state = PathBuf::from(arg_value(&args, "--state").unwrap_or_else(|| ".".into()));
    let _ = std::fs::create_dir_all(&state);

    let token_file = state.join("daemon.token");
    let token = match std::fs::read_to_string(&token_file) {
        Ok(existing) if existing.trim().len() >= 32 => existing.trim().to_owned(),
        _ => {
            let fresh = random_token();
            let _ = std::fs::write(&token_file, format!("{fresh}\n"));
            fresh
        }
    };

    schedule_exit_once(&state);
    let listener = TcpListener::bind(&listen)
        .await
        .expect("bind listen address");

    if std::env::var("FAKE_DAEMON_NO_READY").ok().as_deref() != Some("1") {
        let ready = ready_line(&listener.local_addr().unwrap().to_string(), &token_file);
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{ready}");
        let _ = stdout.flush();
    }

    while let Ok((socket, _)) = listener.accept().await {
        tokio::spawn(handle_conn(socket, token.clone()));
    }
}
