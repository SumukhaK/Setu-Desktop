//! Newline framing for daemon JSON-RPC messages (Setu-SDK v1.1.0 §2).
//!
//! One JSON object per line, UTF-8, `\n`-terminated, at most 1 MiB per line
//! excluding the newline. Pure and synchronous; the client feeds byte chunks.

use serde_json::Value;

use super::errors::SetuError;

/// Maximum line length in bytes, excluding the terminating newline (1 MiB).
pub const MAX_LINE_BYTES: usize = 1_048_576;

/// Encode one message as compact JSON plus a newline.
///
/// Returns `SetuError::FrameTooLarge` without producing bytes when the
/// compact encoding would exceed [`MAX_LINE_BYTES`].
pub fn encode(value: &Value) -> Result<Vec<u8>, SetuError> {
    todo!("compact JSON + newline, cap-checked")
}

/// Incremental decoder that turns incoming byte chunks into complete lines.
#[derive(Debug, Default)]
pub struct LineDecoder {
    buf: Vec<u8>,
}

impl LineDecoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    /// Feed one byte chunk; returns the complete lines it completed, in order.
    ///
    /// Empty lines are skipped. A line that grows past [`MAX_LINE_BYTES`]
    /// — with or without its newline yet — is a framing violation.
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>, SetuError> {
        todo!("accumulate bytes, emit complete lines, enforce the cap")
    }
}
