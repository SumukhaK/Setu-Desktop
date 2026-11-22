//! Local ADB adapter: loopback-only device tracking and `adb connect`.

pub mod connect;
pub mod protocol;
pub mod track;

pub use connect::{
    adb_connect, parse_connect_output, resolve_adb_path, resolve_adb_server, AdbConnectOutcome,
};
pub use track::{start, AdbDevice, AdbSnapshot, AdbWatcher};
