//! JSON-RPC 2.0 client for `setu-daemon` v1.1.0 over loopback TCP.

mod client;
mod errors;
mod framing;

pub use client::{Notification, RpcClient, VersionInfo};
pub use errors::{from_error_object, SetuError};
pub use framing::{encode, LineDecoder, MAX_LINE_BYTES};
