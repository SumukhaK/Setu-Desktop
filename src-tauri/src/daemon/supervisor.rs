//! The supervisor task: spawn / attach / auth / restart-with-backoff / stop.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, oneshot, watch};

use super::config::DaemonConfig;
use super::ready_line::parse;
use super::workspace::{
    read_attach_record, remove_attach_record, write_attach_record, AttachRecord, Workspace,
};
use crate::rpc::{Notification, RpcClient};

/// Consecutive failed attempts before the supervisor gives up.
const MAX_CONSECUTIVE_FAILURES: u32 = 5;

/// How the supervisor behaves: timeouts and backoff. Tests pass small values.
#[derive(Clone)]
pub struct SupervisorOptions {
    pub ready_timeout: Duration,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
}

impl Default for SupervisorOptions {
    fn default() -> Self {
        Self {
            ready_timeout: Duration::from_secs(10),
            backoff_base: Duration::from_millis(500),
            backoff_max: Duration::from_secs(30),
        }
    }
}

/// Published supervisor state. `generation` increases on every new `Ready`;
/// DT-03 re-lists sessions when it changes (P18).
#[derive(Clone)]
pub enum DaemonState {
    Starting,
    Ready {
        client: RpcClient,
        generation: u64,
        pid: u32,
        attached: bool,
    },
    Restarting {
        attempt: u32,
        retry_in: Duration,
    },
    Failed {
        reason: String,
    },
    Stopped,
}

/// A handle to one running supervisor. Clone freely; every clone can
/// subscribe and stop.
#[derive(Clone)]
pub struct Supervisor {
    shared: Arc<SupervisorShared>,
}

struct SupervisorShared {
    state_tx: Arc<watch::Sender<DaemonState>>,
    stop_tx: mpsc::Sender<()>,
    task: tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Supervisor {
    /// Start supervising a workspace. Returns immediately; the work runs on
    /// a spawned task. Must be called inside a tokio runtime.
    pub fn start(
        workspace: Workspace,
        app_data: PathBuf,
        config: DaemonConfig,
        options: SupervisorOptions,
    ) -> Supervisor {
        let state_dir = workspace.state_dir(&app_data);
        let state_tx = Arc::new(watch::Sender::new(DaemonState::Starting));
        let (stop_tx, stop_rx) = mpsc::channel(1);
        let task = tokio::spawn(run(
            state_dir,
            config,
            options,
            Arc::clone(&state_tx),
            stop_rx,
        ));
        Supervisor {
            shared: Arc::new(SupervisorShared {
                state_tx,
                stop_tx,
                task: tokio::sync::Mutex::new(Some(task)),
            }),
        }
    }

    /// Observe the supervisor state.
    pub fn subscribe(&self) -> watch::Receiver<DaemonState> {
        self.shared.state_tx.subscribe()
    }

    /// Stop: kill the spawned child and wait for it, or drop an attached
    /// client; remove the attach record only if this supervisor spawned
    /// that pid; publish `Stopped`. Dropping a `Supervisor` without
    /// `stop()` never kills the daemon (P17).
    pub async fn stop(&self) {
        let _ = self.shared.stop_tx.try_send(());
        let task = self.shared.task.lock().await.take();
        if let Some(task) = task {
            let _ = task.await;
        }
    }
}

/// Backoff before retry `attempt` (1-based): `min(base * 2^(attempt-1), max)`.
fn restart_delay(attempt: u32, base: Duration, max: Duration) -> Duration {
    let mut delay = base;
    for _ in 1..attempt {
        delay = delay.saturating_mul(2);
    }
    delay.min(max)
}

/// A future that resolves only when a real stop request arrives. A dropped
/// stop sender — the `Supervisor` handle was dropped without `stop()` —
/// must never stop the daemon (P17).
async fn stop_signal(stop_rx: &mut mpsc::Receiver<()>) {
    loop {
        match stop_rx.recv().await {
            Some(()) => return,
            None => std::future::pending::<()>().await,
        }
    }
}

/// One running daemon connection: a child we spawned or an attached
/// foreign daemon. The notification channel is the liveness probe.
enum Running {
    Spawned {
        child: Child,
        client: RpcClient,
        notifications: mpsc::UnboundedReceiver<Notification>,
        pid: u32,
    },
    Attached {
        client: RpcClient,
        notifications: mpsc::UnboundedReceiver<Notification>,
        pid: u32,
    },
}

/// Attach to the recorded daemon if it authenticates, else spawn one.
async fn start_once(
    state_dir: &Path,
    config: &DaemonConfig,
    options: &SupervisorOptions,
) -> Result<Running, String> {
    if let Some(record) =
        read_attach_record(state_dir).filter(|record| record.listen.ip().is_loopback())
    {
        // A record pointing outside loopback is treated as stale: the
        // daemon token must never be sent to a non-loopback address.
        if let Some(token) = read_token(&state_dir.join("daemon.token")) {
            let attach = async {
                let (client, notifications) = RpcClient::connect(record.listen).await.ok()?;
                client.auth(&token).await.ok()?;
                Some(Running::Attached {
                    client,
                    notifications,
                    pid: record.pid,
                })
            };
            if let Ok(Some(running)) = tokio::time::timeout(options.ready_timeout, attach).await {
                return Ok(running);
            }
        }
        // The record exists but is not usable: fall through and spawn.
    }
    spawn_once(state_dir, config, options).await
}

fn read_token(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|token| token.trim().to_owned())
        .filter(|token| !token.is_empty())
}

/// Spawn the daemon, await and validate the ready line, authenticate, and
/// write the attach record. Every failure path after spawn kills and waits
/// for the child.
async fn spawn_once(
    state_dir: &Path,
    config: &DaemonConfig,
    options: &SupervisorOptions,
) -> Result<Running, String> {
    std::fs::create_dir_all(state_dir)
        .map_err(|error| format!("failed to create the state dir: {error}"))?;
    let mut command = Command::new(&config.daemon_path);
    command.args(config.to_args(state_dir));
    command
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn the daemon executable: {error}"))?;
    let stdout = child.stdout.take().expect("stdout is piped");

    let (line_tx, line_rx) = oneshot::channel::<String>();
    drain_stdout(stdout, line_tx);

    let line = match tokio::time::timeout(options.ready_timeout, line_rx).await {
        Ok(Ok(line)) if !line.trim().is_empty() => line,
        Ok(_) => {
            return Err(kill_child(
                child,
                "daemon exited before printing daemon_ready".to_owned(),
            ))
        }
        Err(_) => {
            let reason = format!(
                "daemon did not print daemon_ready within {:?}",
                options.ready_timeout
            );
            return Err(kill_child(child, reason));
        }
    };
    let ready = match parse(line.trim()) {
        Ok(ready) => ready,
        Err(_) => {
            return Err(kill_child(
                child,
                "daemon printed an invalid daemon_ready line".to_owned(),
            ))
        }
    };

    let connected = tokio::time::timeout(options.ready_timeout, async {
        let token = read_token(&ready.token_file)
            .ok_or_else(|| "the token file is missing or empty".to_owned())?;
        let (client, notifications) = RpcClient::connect(ready.listen)
            .await
            .map_err(|error| format!("connect failed: {error}"))?;
        client
            .auth(&token)
            .await
            .map_err(|error| format!("auth failed: {error}"))?;
        Ok::<_, String>((client, notifications))
    })
    .await;
    let (client, notifications) = match connected {
        Ok(Ok(connected)) => connected,
        Ok(Err(reason)) => return Err(kill_child(child, reason)),
        Err(_) => {
            return Err(kill_child(
                child,
                "connecting or authenticating timed out".to_owned(),
            ))
        }
    };

    let record = AttachRecord {
        listen: ready.listen,
        pid: ready.pid,
        version: ready.version,
    };
    match write_attach_record(state_dir, &record) {
        Ok(()) => {}
        // A live child must not be leaked: every failure path after spawn
        // kills and waits.
        Err(error) => {
            return Err(kill_child(
                child,
                format!("failed to write the attach record: {error}"),
            ))
        }
    };
    Ok(Running::Spawned {
        child,
        client,
        notifications,
        pid: ready.pid,
    })
}

/// Kill the child and wait for it to exit; both return promptly once it is
/// killed.
fn kill_child(mut child: Child, reason: String) -> String {
    let _ = child.kill();
    let _ = child.wait();
    reason
}

/// Drain the daemon's stdout on its own OS thread: the first line is sent
/// to `first_line`, everything after it is discarded until EOF.
///
/// A dedicated thread — not a tokio task — keeps the pipe read off tokio's
/// blocking pool: on Windows a pending pool read of a live daemon's pipe
/// would make the runtime's shutdown wait forever, and the daemon must
/// outlive the runtime (P17).
fn drain_stdout(stdout: std::process::ChildStdout, first_line: oneshot::Sender<String>) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let _ = reader.read_line(&mut line);
        let _ = first_line.send(line);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });
}

enum SuperviseOutcome {
    Stopped,
    Exited(String),
}

/// Wait for the daemon to go away (EOF on the connection) or a stop request.
async fn supervise(
    child: &mut Option<Child>,
    notifications: &mut mpsc::UnboundedReceiver<Notification>,
    stop_rx: &mut mpsc::Receiver<()>,
    state_tx: &watch::Sender<DaemonState>,
    state_dir: &Path,
    owns_record: bool,
) -> SuperviseOutcome {
    tokio::select! {
        _ = stop_signal(stop_rx) => {
            if let Some(mut child) = child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            if owns_record {
                remove_attach_record(state_dir);
            }
            let _ = state_tx.send(DaemonState::Stopped);
            SuperviseOutcome::Stopped
        }
        _ = connection_end(notifications) => {
            let reason = match child.take() {
                Some(mut child) => {
                    // Reap off the runtime thread; it completes as soon as
                    // the exited process is collected.
                    let outcome = tokio::task::spawn_blocking(move || child.wait()).await;
                    match outcome {
                        Ok(Ok(status)) => format!("daemon exited unexpectedly ({status})"),
                        Ok(Err(error)) => format!("daemon exited unexpectedly ({error})"),
                        Err(_) => {
                            "daemon exited unexpectedly (the reaper task failed)".to_owned()
                        }
                    }
                }
                None => "attached daemon connection closed".to_owned(),
            };
            SuperviseOutcome::Exited(reason)
        }
    }
}

/// Resolves when the daemon's notification channel ends; notifications
/// themselves are ignored (DT-03 owns them).
async fn connection_end(notifications: &mut mpsc::UnboundedReceiver<Notification>) {
    loop {
        match notifications.recv().await {
            Some(_) => continue,
            None => return,
        }
    }
}

async fn run(
    state_dir: PathBuf,
    config: DaemonConfig,
    options: SupervisorOptions,
    state_tx: Arc<watch::Sender<DaemonState>>,
    mut stop_rx: mpsc::Receiver<()>,
) {
    let mut generation: u64 = 1;
    let mut attempt: u32 = 0; // consecutive failures so far
    let mut owns_record = false;
    let mut reason = String::from("the daemon never became ready");
    loop {
        if attempt >= MAX_CONSECUTIVE_FAILURES {
            let _ = state_tx.send(DaemonState::Failed { reason });
            return;
        }
        if attempt > 0 {
            let retry_in = restart_delay(attempt, options.backoff_base, options.backoff_max);
            let _ = state_tx.send(DaemonState::Restarting { attempt, retry_in });
            tokio::select! {
                _ = stop_signal(&mut stop_rx) => {
                    if owns_record {
                        remove_attach_record(&state_dir);
                    }
                    let _ = state_tx.send(DaemonState::Stopped);
                    return;
                }
                _ = tokio::time::sleep(retry_in) => {}
            }
        }
        match start_once(&state_dir, &config, &options).await {
            Ok(running) => {
                let (client, mut notifications, pid, attached, mut child) = match running {
                    Running::Spawned {
                        child,
                        client,
                        notifications,
                        pid,
                    } => (client, notifications, pid, false, Some(child)),
                    Running::Attached {
                        client,
                        notifications,
                        pid,
                    } => (client, notifications, pid, true, None),
                };
                owns_record = !attached;
                let _ = state_tx.send(DaemonState::Ready {
                    client,
                    generation,
                    pid,
                    attached,
                });
                generation += 1;
                // attempt resets on a Ready: the next exit or failure counts
                // as attempt 1 again.
                match supervise(
                    &mut child,
                    &mut notifications,
                    &mut stop_rx,
                    &state_tx,
                    &state_dir,
                    owns_record,
                )
                .await
                {
                    SuperviseOutcome::Stopped => return,
                    SuperviseOutcome::Exited(exit_reason) => {
                        attempt = 1;
                        reason = exit_reason;
                    }
                }
            }
            Err(failure_reason) => {
                reason = failure_reason;
                attempt += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_delay_doubles_and_caps_at_max() {
        let base = Duration::from_millis(500);
        let max = Duration::from_secs(30);
        assert_eq!(restart_delay(1, base, max), Duration::from_millis(500));
        assert_eq!(restart_delay(2, base, max), Duration::from_secs(1));
        assert_eq!(restart_delay(3, base, max), Duration::from_secs(2));
        assert_eq!(restart_delay(6, base, max), Duration::from_secs(16));
        assert_eq!(restart_delay(7, base, max), max);
        assert_eq!(restart_delay(50, base, max), max);
    }
}
