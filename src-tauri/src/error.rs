//! Unified error type for all Tauri commands.
//!
//! Migrates from the `Result<T, String>` anti-pattern to a proper typed
//! error that still serializes as a human-readable string for the frontend.
//!
//! Each variant carries a message string. `Display` and `Serialize` both
//! produce the message, so the frontend receives `{ "error": "..." }`.

use serde::Serialize;

#[derive(Debug, Clone)]
pub enum AppError {
  /// Network/HTTP/proxy operation failed.
  Network(String),
  /// User input failed validation.
  InvalidInput(String),
  /// File-system or I/O error.
  Io(String),
  /// Operation was cancelled by the user.
  Cancelled,
  /// Resource or connection not found.
  NotFound(String),
  /// Non-fast-forward push rejection with actionable suggestion.
  NonFastForward(String),
  /// Resource is already in the requested state (e.g. already running).
  AlreadyRunning(String),
  /// Resource is not in the expected state (e.g. not running).
  NotRunning(String),
  /// Runtime initialisation or internal invariant failure.
  Internal(String),
  /// Serialisation/deserialisation error.
  Serde(String),
}

impl std::fmt::Display for AppError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      AppError::Network(msg) => write!(f, "{}", msg),
      AppError::InvalidInput(msg) => write!(f, "{}", msg),
      AppError::Io(msg) => write!(f, "{}", msg),
      AppError::Cancelled => write!(f, "cancelled"),
      AppError::NotFound(msg) => write!(f, "{}", msg),
      AppError::NonFastForward(msg) => write!(f, "{}", msg),
      AppError::AlreadyRunning(msg) => write!(f, "{}", msg),
      AppError::NotRunning(msg) => write!(f, "{}", msg),
      AppError::Internal(msg) => write!(f, "{}", msg),
      AppError::Serde(msg) => write!(f, "{}", msg),
    }
  }
}

impl Serialize for AppError {
  fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&self.to_string())
  }
}

// ── Conversions ──────────────────────────────────────────────────────────

impl From<std::io::Error> for AppError {
  fn from(e: std::io::Error) -> Self {
    AppError::Io(e.to_string())
  }
}

impl From<serde_json::Error> for AppError {
  fn from(e: serde_json::Error) -> Self {
    AppError::Serde(e.to_string())
  }
}

impl From<reqwest::Error> for AppError {
  fn from(e: reqwest::Error) -> Self {
    AppError::Network(e.to_string())
  }
}

impl<T> From<std::sync::PoisonError<T>> for AppError {
  fn from(e: std::sync::PoisonError<T>) -> Self {
    AppError::Internal(format!("Lock poisoned: {}", e))
  }
}

impl From<git2::Error> for AppError {
  fn from(e: git2::Error) -> Self {
    AppError::Internal(e.to_string())
  }
}
