//! Dedicated events connection and ordered forwarder (AD-10, AD-11).

use std::path::PathBuf;

use tokio::sync::{mpsc, watch};

use crate::daemon::DaemonState;
use crate::events::model::HubMessage;

#[derive(Clone)]
pub struct EventHub {
    resync_tx: mpsc::UnboundedSender<()>,
}

impl EventHub {
    pub fn resync(&self) {
        let _ = self.resync_tx.send(());
    }
}

pub fn start(
    _states: watch::Receiver<DaemonState>,
    _state_dir: PathBuf,
) -> (EventHub, mpsc::UnboundedReceiver<HubMessage>) {
    let (resync_tx, _resync_rx) = mpsc::unbounded_channel();
    let (_message_tx, message_rx) = mpsc::unbounded_channel();
    (EventHub { resync_tx }, message_rx)
}
