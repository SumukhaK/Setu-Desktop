//! Daemon supervisor: one `setu-daemon` per workspace (AD-6, AD-7).

mod config;
mod ready_line;
mod supervisor;
mod workspace;

pub use config::{CorporateFlags, DaemonConfig};
pub use ready_line::{parse, ReadyLine};
pub use supervisor::{connect_authenticated, DaemonState, Supervisor, SupervisorOptions};
pub use workspace::{
    attach_record_path, read_attach_record, remove_attach_record, write_attach_record,
    AttachRecord, Workspace,
};
