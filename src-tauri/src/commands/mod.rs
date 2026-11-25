//! Native commands that never import Tauri (AD-1, AD-12).

pub mod devices;
pub mod diagnostics;
pub mod pair_adb;
pub mod quit;
pub mod session;

pub use devices::{
    forget_device, list_devices, set_nickname, DeviceRow, ForgetOutcome, ListOutcome,
    NicknameOutcome,
};
pub use diagnostics::{run_doctor, DoctorCheck, DoctorOutcome};
pub use pair_adb::{pair_adb, AdbPairCode, PairAdbOutcome};
pub use quit::{end_all_sessions, QuitLatch, QuitOutcome};
pub use session::{cancel_pending, connect_with_code, ConnectOutcome, PairingCode, PendingConnect};
