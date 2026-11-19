//! The supervisor task: spawn / attach / auth / restart-with-backoff / stop.

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::{mpsc, watch};

use super::config::DaemonConfig;
use super::workspace::Workspace;

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

/// Published supervisor state (AD-7). `generation` increases on every new
/// `Ready`; DT-03 re-lists sessions when it changes (P18).
#[derive(Clone)]
pub enum DaemonState {
    Starting,
    Ready {
        client: crate::rpc::RpcClient,
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
    shared: std::sync::Arc<SupervisorShared>,
}

struct SupervisorShared {
    state_tx: std::sync::Arc<watch::Sender<DaemonState>>,
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
        todo!("spawn the run task")
    }

    /// Observe the supervisor state.
    pub fn subscribe(&self) -> watch::Receiver<DaemonState> {
        todo!("subscribe")
    }

    /// Stop: kill the spawned child and wait for it, or drop an attached
    /// client; remove the attach record only if this supervisor spawned
    /// that pid; publish `Stopped`. Dropping a `Supervisor` without
    /// `stop()` never kills the daemon (P17).
    pub async fn stop(&self) {
        todo!("stop")
    }
}

/// Backoff before retry `attempt` (1-based): `min(base * 2^(attempt-1), max)`.
fn restart_delay(attempt: u32, base: Duration, max: Duration) -> Duration {
    todo!("backoff")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_delay_doubles_and_caps_at_max() {
        todo!("red: backoff")
    }
}
