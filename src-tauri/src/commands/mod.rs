//! Native commands that never import Tauri (AD-1, AD-12).

pub mod devices;
pub mod quit;
pub mod session;

pub use devices::{
    forget_device, list_devices, set_nickname, DeviceRow, ForgetOutcome, ListOutcome,
    NicknameOutcome,
};
pub use quit::{end_all_sessions, QuitLatch, QuitOutcome};
pub use session::{cancel_pending, connect_with_code, ConnectOutcome, PairingCode, PendingConnect};
