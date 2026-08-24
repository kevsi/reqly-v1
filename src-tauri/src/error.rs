//! Unified error type for all Tauri commands.
//!
//! Network errors keep a stable, human-readable Display representation while
//! also carrying a structured classification and the original technical detail.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkErrorKind {
    ConnectionRefused,
    ConnectionTimeout,
    DnsResolutionFailed,
    TlsHandshakeFailed,
    CertificateUntrusted,
    CertificateExpired,
    ConnectionReset,
    MalformedResponse,
    Unknown,
}

impl NetworkErrorKind {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ConnectionRefused => "connection_refused",
            Self::ConnectionTimeout => "connection_timeout",
            Self::DnsResolutionFailed => "dns_resolution_failed",
            Self::TlsHandshakeFailed => "tls_handshake_failed",
            Self::CertificateUntrusted => "certificate_untrusted",
            Self::CertificateExpired => "certificate_expired",
            Self::ConnectionReset => "connection_reset",
            Self::MalformedResponse => "malformed_response",
            Self::Unknown => "unknown",
        }
    }

    pub fn user_message(&self) -> &'static str {
        match self {
            Self::ConnectionRefused => "Connexion refusée par le serveur distant.",
            Self::ConnectionTimeout => "La connexion a expiré.",
            Self::DnsResolutionFailed => "Impossible de résoudre le nom de domaine.",
            Self::TlsHandshakeFailed => "Échec de la négociation TLS.",
            Self::CertificateUntrusted => "Le certificat TLS n’est pas approuvé.",
            Self::CertificateExpired => "Le certificat TLS a expiré.",
            Self::ConnectionReset => "La connexion a été interrompue par le serveur.",
            Self::MalformedResponse => "La réponse du serveur est invalide.",
            Self::Unknown => "La requête réseau a échoué.",
        }
    }
}

#[derive(Debug, Clone)]
pub enum AppError {
    /// Network/HTTP/proxy operation failed.
    Network {
        kind: NetworkErrorKind,
        message: String,
        detail: String,
    },
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

impl AppError {
    pub fn network(kind: NetworkErrorKind, message: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::Network {
            kind,
            message: message.into(),
            detail: detail.into(),
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::Network { message, .. } => message.clone(),
            Self::InvalidInput(message)
            | Self::Io(message)
            | Self::NotFound(message)
            | Self::NonFastForward(message)
            | Self::AlreadyRunning(message)
            | Self::NotRunning(message)
            | Self::Internal(message)
            | Self::Serde(message) => message.clone(),
            Self::Cancelled => "L’opération a été annulée.".to_string(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Network { message, .. } => write!(f, "{}", message),
            AppError::InvalidInput(message)
            | AppError::Io(message)
            | AppError::NotFound(message)
            | AppError::NonFastForward(message)
            | AppError::AlreadyRunning(message)
            | AppError::NotRunning(message)
            | AppError::Internal(message)
            | AppError::Serde(message) => write!(f, "{}", message),
            AppError::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    kind: &'a str,
    code: &'a str,
    message: &'a str,
    detail: &'a str,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let payload = match self {
            Self::Network {
                kind,
                message,
                detail,
            } => ErrorPayload {
                kind: "network",
                code: kind.code(),
                message,
                detail,
            },
            Self::InvalidInput(message) => ErrorPayload {
                kind: "invalid_input",
                code: "invalid_input",
                message,
                detail: message,
            },
            Self::Io(message) => ErrorPayload {
                kind: "io",
                code: "io_error",
                message,
                detail: message,
            },
            Self::Cancelled => ErrorPayload {
                kind: "cancelled",
                code: "cancelled",
                message: "L’opération a été annulée.",
                detail: "cancelled",
            },
            Self::NotFound(message) => ErrorPayload {
                kind: "not_found",
                code: "not_found",
                message,
                detail: message,
            },
            Self::NonFastForward(message) => ErrorPayload {
                kind: "git",
                code: "non_fast_forward",
                message,
                detail: message,
            },
            Self::AlreadyRunning(message) => ErrorPayload {
                kind: "state",
                code: "already_running",
                message,
                detail: message,
            },
            Self::NotRunning(message) => ErrorPayload {
                kind: "state",
                code: "not_running",
                message,
                detail: message,
            },
            Self::Internal(message) => ErrorPayload {
                kind: "internal",
                code: "internal_error",
                message,
                detail: message,
            },
            Self::Serde(message) => ErrorPayload {
                kind: "serde",
                code: "serialization_error",
                message,
                detail: message,
            },
        };
        payload.serialize(serializer)
    }
}

fn classify_network_signals(
    is_connect: bool,
    is_timeout: bool,
    is_decode: bool,
    detail: &str,
) -> NetworkErrorKind {
    let lower = detail.to_ascii_lowercase();

    if lower.contains("-2146893048")
        || lower.contains("0x80090308")
        || lower.contains("sec_e_invalid_token")
        || lower.contains("schannel")
    {
        return NetworkErrorKind::TlsHandshakeFailed;
    }
    if lower.contains("certificate verify failed")
        || lower.contains("unknownissuer")
        || lower.contains("unknown issuer")
    {
        return NetworkErrorKind::CertificateUntrusted;
    }
    if lower.contains("certificate has expired") || lower.contains("certificate expired") {
        return NetworkErrorKind::CertificateExpired;
    }
    if lower.contains("connection reset") || lower.contains("econnreset") {
        return NetworkErrorKind::ConnectionReset;
    }
    if lower.contains("connection refused") || lower.contains("econnrefused") {
        return NetworkErrorKind::ConnectionRefused;
    }
    if lower.contains("failed to lookup address")
        || lower.contains("dns")
        || lower.contains("enotfound")
        || lower.contains("name or service not known")
        || lower.contains("nodename nor servname")
    {
        return NetworkErrorKind::DnsResolutionFailed;
    }
    if is_timeout || lower.contains("timed out") || lower.contains("timeout") {
        return NetworkErrorKind::ConnectionTimeout;
    }
    if is_decode {
        return NetworkErrorKind::MalformedResponse;
    }
    if is_connect {
        return NetworkErrorKind::Unknown;
    }
    NetworkErrorKind::Unknown
}

fn classify_reqwest_error(error: &reqwest::Error) -> NetworkErrorKind {
    let mut details = Vec::new();
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(source) = current {
        details.push(source.to_string());
        current = source.source();
    }
    classify_network_signals(
        error.is_connect(),
        error.is_timeout(),
        error.is_decode(),
        &details.join(" | "),
    )
}

// ── Conversions ────────────────────────────────────────────────────────────

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::Io(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        AppError::Serde(error.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(error: reqwest::Error) -> Self {
        let detail = error.to_string();
        let kind = classify_reqwest_error(&error);
        let message = kind.user_message().to_string();
        AppError::network(kind, message, detail)
    }
}

impl<T> From<std::sync::PoisonError<T>> for AppError {
    fn from(error: std::sync::PoisonError<T>) -> Self {
        AppError::Internal(format!("Lock poisoned: {}", error))
    }
}

impl From<git2::Error> for AppError {
    fn from(error: git2::Error) -> Self {
        AppError::Internal(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_network_signals, NetworkErrorKind};

    #[test]
    fn classifies_connection_refused() {
        assert_eq!(
            classify_network_signals(true, false, false, "tcp connect error: connection refused"),
            NetworkErrorKind::ConnectionRefused
        );
    }

    #[test]
    fn classifies_schannel_invalid_token_as_tls_handshake() {
        assert_eq!(
            classify_network_signals(true, false, false, "os error -2146893048 SEC_E_INVALID_TOKEN"),
            NetworkErrorKind::TlsHandshakeFailed
        );
    }

    #[test]
    fn classifies_timeout() {
        assert_eq!(
            classify_network_signals(false, true, false, "operation timed out"),
            NetworkErrorKind::ConnectionTimeout
        );
    }

    #[test]
    fn classifies_dns_failure() {
        assert_eq!(
            classify_network_signals(true, false, false, "failed to lookup address: ENOTFOUND"),
            NetworkErrorKind::DnsResolutionFailed
        );
    }

    #[test]
    fn classifies_malformed_response() {
        assert_eq!(
            classify_network_signals(false, false, true, "error decoding response body"),
            NetworkErrorKind::MalformedResponse
        );
    }
}
