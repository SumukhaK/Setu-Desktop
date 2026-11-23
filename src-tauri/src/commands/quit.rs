//! Quit flow: end every live session before the shell stops the supervisor.
//! No Tauri import here (AD-1); the shell owns the window and the exit.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use crate::commands::session::{stop_session, StopOutcome};
use crate::events::parse_session_list;
use crate::rpc::RpcClient;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum QuitOutcome {
    NotReady,
    Ended { stopped: usize, failed: usize },
    ListFailed { code: Option<i64> },
}

/// Stop every session in the freshly listed order, continuing past failures.
pub async fn end_all_sessions(client: Option<RpcClient>) -> QuitOutcome {
    let Some(client) = client else {
        return QuitOutcome::NotReady;
    };
    let listed = client.call("session.list", None).await;
    let value = match listed {
        Ok(value) => value,
        Err(error) => return QuitOutcome::ListFailed { code: error.code() },
    };
    let sessions = match parse_session_list(&value) {
        Ok(sessions) => sessions,
        Err(error) => return QuitOutcome::ListFailed { code: error.code() },
    };

    let mut stopped = 0;
    let mut failed = 0;
    for session in sessions {
        match stop_session(Some(client.clone()), &session.session_id).await {
            StopOutcome::Stopped | StopOutcome::NoSession => stopped += 1,
            _ => failed += 1,
        }
    }
    QuitOutcome::Ended { stopped, failed }
}

/// One quit per process: the tray menu and the UI confirm can race.
#[derive(Default)]
pub struct QuitLatch(AtomicBool);

impl QuitLatch {
    pub fn try_begin(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_tags_match_the_bridge() {
        assert_eq!(
            serde_json::to_value(QuitOutcome::NotReady).unwrap()["outcome"],
            "not_ready"
        );
        assert_eq!(
            serde_json::to_value(QuitOutcome::Ended {
                stopped: 1,
                failed: 2
            })
            .unwrap()["outcome"],
            "ended"
        );
        assert_eq!(
            serde_json::to_value(QuitOutcome::ListFailed { code: Some(-32603) }).unwrap()
                ["outcome"],
            "list_failed"
        );
    }
}
