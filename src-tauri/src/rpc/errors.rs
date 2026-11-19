//! Typed errors for the whole daemon error table (Setu-SDK v1.1.0 §2.3, AD-2).

use serde_json::Value;

/// Client-side error for every failure this crate can report.
#[derive(Debug, thiserror::Error)]
pub enum SetuError {
    /// A JSON-RPC protocol error (-32700, -32600, -32601, -32602, -32603).
    #[error("protocol error {code}: {message}")]
    Protocol { code: i64, message: String },
    /// -32001: the connection is not authenticated.
    #[error("unauthorized")]
    Unauthorized,
    /// -32010 and every code outside the table: refused, raw code and kind kept, never guessed (AD-2).
    #[error("denied {code}: {message}")]
    Denied {
        code: i64,
        kind: String,
        message: String,
    },
    /// -32011: device offline or relay unreachable.
    #[error("unavailable")]
    Unavailable,
    /// -32012: no pairing exists for this device.
    #[error("not paired")]
    NotPaired,
    /// -32013: wrong, expired or malformed pairing code.
    #[error("bad pairing code")]
    BadCode,
    /// -32014: access was revoked.
    #[error("access revoked")]
    Revoked,
    /// -32015: corporate token failed verification.
    #[error("token invalid")]
    TokenInvalid,
    /// -32016: corporate token has expired.
    #[error("token expired")]
    TokenExpired,
    /// -32017: policy does not grant this user the device.
    #[error("no grant")]
    NoGrant,
    /// -32018: device management disallows debugging.
    #[error("blocked")]
    Blocked,
    /// -32020: no such session.
    #[error("no session")]
    NoSession,
    /// -32021: audit is off for this workspace.
    #[error("audit disabled")]
    AuditDisabled,
    /// -32022: ended by `session.cancel`.
    #[error("cancelled")]
    Cancelled,
    /// -32023: `adb pair` failed.
    #[error("adb pair failed")]
    AdbPairFailed,
    /// -32024: the peer runs an older version without this feature.
    #[error("unsupported")]
    Unsupported,
    /// -32025: corporate session cap reached.
    #[error("session expired")]
    SessionExpired,
    /// -32026: the device ended the session.
    #[error("peer closed")]
    PeerClosed,
    /// -32027: too many requests in flight; retried once internally (AD-4).
    #[error("daemon busy")]
    Busy,
    /// A frame would exceed the 1 MiB line limit.
    #[error("frame too large")]
    FrameTooLarge,
    /// The connection is closed; pending and later calls cannot complete (AD-3).
    #[error("connection closed")]
    Disconnected,
    /// Only from the initial connect (AD-3 maps every later transport failure to `Disconnected`).
    #[error("io error")]
    Io(#[from] std::io::Error),
    /// A result does not match the typed helper's shape.
    #[error("unexpected result shape")]
    UnexpectedResult,
}

impl SetuError {
    /// The daemon error code behind this error, when it came from one.
    pub fn code(&self) -> Option<i64> {
        match self {
            SetuError::Protocol { code, .. } | SetuError::Denied { code, .. } => Some(*code),
            SetuError::Unauthorized => Some(-32001),
            SetuError::Unavailable => Some(-32011),
            SetuError::NotPaired => Some(-32012),
            SetuError::BadCode => Some(-32013),
            SetuError::Revoked => Some(-32014),
            SetuError::TokenInvalid => Some(-32015),
            SetuError::TokenExpired => Some(-32016),
            SetuError::NoGrant => Some(-32017),
            SetuError::Blocked => Some(-32018),
            SetuError::NoSession => Some(-32020),
            SetuError::AuditDisabled => Some(-32021),
            SetuError::Cancelled => Some(-32022),
            SetuError::AdbPairFailed => Some(-32023),
            SetuError::Unsupported => Some(-32024),
            SetuError::SessionExpired => Some(-32025),
            SetuError::PeerClosed => Some(-32026),
            SetuError::Busy => Some(-32027),
            SetuError::FrameTooLarge
            | SetuError::Disconnected
            | SetuError::Io(_)
            | SetuError::UnexpectedResult => None,
        }
    }
}

/// Map a JSON-RPC error object (`{"code", "message", "data": {"kind"}}`) to `SetuError` (AD-2).
pub fn from_error_object(error: &Value) -> SetuError {
    let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32603);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let kind = error
        .get("data")
        .and_then(|data| data.get("kind"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_default();
    match code {
        -32700 | -32600 | -32601 | -32602 | -32603 => SetuError::Protocol { code, message },
        -32001 => SetuError::Unauthorized,
        -32010 => SetuError::Denied {
            code,
            kind,
            message,
        },
        -32011 => SetuError::Unavailable,
        -32012 => SetuError::NotPaired,
        -32013 => SetuError::BadCode,
        -32014 => SetuError::Revoked,
        -32015 => SetuError::TokenInvalid,
        -32016 => SetuError::TokenExpired,
        -32017 => SetuError::NoGrant,
        -32018 => SetuError::Blocked,
        -32020 => SetuError::NoSession,
        -32021 => SetuError::AuditDisabled,
        -32022 => SetuError::Cancelled,
        -32023 => SetuError::AdbPairFailed,
        -32024 => SetuError::Unsupported,
        -32025 => SetuError::SessionExpired,
        -32026 => SetuError::PeerClosed,
        -32027 => SetuError::Busy,
        // Anything else (for example -32019, -32099) stays raw, never guessed (AD-2).
        _ => SetuError::Denied {
            code,
            kind,
            message,
        },
    }
}
