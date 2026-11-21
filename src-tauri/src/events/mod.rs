//! Typed events bridge: dedicated connection, resync gate and UI messages.

pub mod gate;
pub mod hub;
pub mod model;

pub use gate::{Action, ResyncGate};
pub use hub::{start, EventHub};
pub use model::{
    parse_notification, parse_session_list, HubEvent, HubMessage, Parsed, SessionInfo,
};
