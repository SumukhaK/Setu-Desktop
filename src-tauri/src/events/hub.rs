//! Dedicated events connection and ordered forwarder (AD-10, AD-11).

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::sync::{mpsc, watch};
use tokio::time::Instant;

use crate::daemon::{connect_authenticated, DaemonState};
use crate::events::gate::{Action, ResyncGate};
use crate::events::model::{
    parse_notification, parse_session_list, HubMessage, Parsed, SessionInfo,
};
use crate::rpc::{Notification, RpcClient, SetuError};

const RETRY_DELAY: Duration = Duration::from_secs(1);

type ListResult = Result<Vec<SessionInfo>, SetuError>;

#[derive(Clone)]
pub struct EventHub {
    resync_tx: mpsc::UnboundedSender<()>,
}

impl EventHub {
    /// Non-blocking request for a fresh `session.list` snapshot.
    pub fn resync(&self) {
        let _ = self.resync_tx.send(());
    }
}

fn emit(out: &mpsc::UnboundedSender<HubMessage>, message: HubMessage) {
    let _ = out.send(message);
}

struct Connection {
    generation: Option<u64>,
    client: Option<RpcClient>,
    notifications: Option<mpsc::UnboundedReceiver<Notification>>,
    list_rx: Option<mpsc::UnboundedReceiver<ListResult>>,
    list_tx: Option<mpsc::UnboundedSender<ListResult>>,
    retry_at: Option<Instant>,
}

impl Connection {
    fn new() -> Self {
        Self {
            generation: None,
            client: None,
            notifications: None,
            list_rx: None,
            list_tx: None,
            retry_at: None,
        }
    }

    fn is_connected(&self) -> bool {
        self.generation.is_some()
    }

    fn clear(&mut self, out: &mpsc::UnboundedSender<HubMessage>, announce: bool) {
        if announce {
            if let Some(generation) = self.generation.take() {
                emit(out, HubMessage::Unavailable { generation });
            }
        } else {
            self.generation = None;
        }
        self.client = None;
        self.notifications = None;
        self.list_rx = None;
        self.list_tx = None;
        self.retry_at = None;
    }
}

/// `session.list` runs in its own task; the notification loop is never
/// blocked by a slow list. Results return over a channel to the hub task.
fn spawn_list(client: &RpcClient, list_tx: &mpsc::UnboundedSender<ListResult>) {
    let client = client.clone();
    let list_tx = list_tx.clone();
    tokio::spawn(async move {
        let result = async {
            let value = client.call("session.list", None).await?;
            parse_session_list(&value)
        }
        .await;
        let _ = list_tx.send(result);
    });
}

fn schedule_retry(connection: &mut Connection) {
    connection.retry_at = Some(Instant::now() + RETRY_DELAY);
}

/// Connect, subscribe, then begin a resync and start the first list.
async fn connect(
    connection: &mut Connection,
    generation: u64,
    listen: SocketAddr,
    state_dir: &Path,
    gate: &mut ResyncGate,
    out: &mpsc::UnboundedSender<HubMessage>,
) {
    let (client, notifications) = match connect_authenticated(listen, state_dir).await {
        Ok(pair) => pair,
        Err(_) => {
            emit(out, HubMessage::Unavailable { generation });
            schedule_retry(connection);
            return;
        }
    };
    // Subscribe before listing: no event can fall between the two calls.
    if client.call("events.subscribe", None).await.is_err() {
        emit(out, HubMessage::Unavailable { generation });
        schedule_retry(connection);
        return;
    }
    let (list_tx, list_rx) = mpsc::unbounded_channel();
    let _ = gate.begin(generation);
    spawn_list(&client, &list_tx);
    connection.generation = Some(generation);
    connection.client = Some(client);
    connection.notifications = Some(notifications);
    connection.list_rx = Some(list_rx);
    connection.list_tx = Some(list_tx);
    connection.retry_at = None;
}

/// Start the hub task. Dropping every `EventHub` handle ends the task and
/// closes its dedicated daemon connection; it never stops sessions (P17).
pub fn start(
    states: watch::Receiver<DaemonState>,
    state_dir: PathBuf,
) -> (EventHub, mpsc::UnboundedReceiver<HubMessage>) {
    let (resync_tx, resync_rx) = mpsc::unbounded_channel();
    let (out, messages) = mpsc::unbounded_channel();
    tokio::spawn(run(states, state_dir, out, resync_rx));
    (EventHub { resync_tx }, messages)
}

async fn run(
    mut states: watch::Receiver<DaemonState>,
    state_dir: PathBuf,
    out: mpsc::UnboundedSender<HubMessage>,
    mut resync_rx: mpsc::UnboundedReceiver<()>,
) {
    let mut gate = ResyncGate::new();
    let mut connection = Connection::new();

    loop {
        let state = states.borrow_and_update().clone();
        if let DaemonState::Ready {
            generation, listen, ..
        } = state
        {
            if connection.generation.is_some() && connection.generation != Some(generation) {
                connection.clear(&out, false);
            }
            if !connection.is_connected() && connection.retry_at.is_none() {
                connect(
                    &mut connection,
                    generation,
                    listen,
                    &state_dir,
                    &mut gate,
                    &out,
                )
                .await;
            }
        } else {
            connection.clear(&out, true);
        }

        tokio::select! {
            changed = states.changed() => {
                if changed.is_err() {
                    break;
                }
            }
            request = resync_rx.recv() => {
                if request.is_none() {
                    break;
                }
                if connection.is_connected() && matches!(gate.request_resync(), Some(Action::ListSessions)) {
                    if let (Some(client), Some(list_tx)) =
                        (connection.client.as_ref(), connection.list_tx.as_ref())
                    {
                        spawn_list(client, list_tx);
                    }
                }
            }
            notification = async {
                match connection.notifications.as_mut() {
                    Some(receiver) => receiver.recv().await,
                    None => std::future::pending::<Option<Notification>>().await,
                }
            } => {
                match notification {
                    Some(notification) => match parse_notification(&notification) {
                        Parsed::Event(event) => {
                            for message in gate.on_event(event) {
                                emit(&out, message);
                            }
                        }
                        Parsed::Dropped { .. } => {
                            if connection.is_connected()
                                && matches!(gate.request_resync(), Some(Action::ListSessions))
                            {
                                if let (Some(client), Some(list_tx)) =
                                    (connection.client.as_ref(), connection.list_tx.as_ref())
                                {
                                    spawn_list(client, list_tx);
                                }
                            }
                        }
                        Parsed::Ignored => {}
                    },
                    None => {
                        connection.clear(&out, true);
                        schedule_retry(&mut connection);
                    }
                }
            }
            result = async {
                match connection.list_rx.as_mut() {
                    Some(receiver) => receiver.recv().await,
                    None => std::future::pending::<Option<ListResult>>().await,
                }
            } => {
                match result {
                    Some(Ok(sessions)) => {
                        let (messages, action) = gate.on_sessions(sessions);
                        for message in messages {
                            emit(&out, message);
                        }
                        if matches!(action, Some(Action::ListSessions)) {
                            if let (Some(client), Some(list_tx)) =
                                (connection.client.as_ref(), connection.list_tx.as_ref())
                            {
                                spawn_list(client, list_tx);
                            }
                        }
                    }
                    Some(Err(_)) | None => {
                        connection.clear(&out, true);
                        schedule_retry(&mut connection);
                    }
                }
            }
            _ = async {
                match connection.retry_at {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                connection.retry_at = None;
            }
        }
    }
}
