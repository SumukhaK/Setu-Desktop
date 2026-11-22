//! Native commands that never import Tauri (AD-1, AD-12).

pub mod session;

pub use session::{cancel_pending, connect_with_code, ConnectOutcome, PairingCode, PendingConnect};
