//! OAuth device flow for GitHub / GitLab (RFC 8628).
//!
//! The desktop flow uses the OAuth 2.0 Device Authorization Grant, which is
//! designed for apps that cannot keep a `client_secret` secret (desktop
//! binaries). No secret is stored or embedded anywhere:
//!   - [`start_device_flow`] asks the provider for a `device_code` and a
//!     human-friendly `user_code` plus a verification URI.
//!   - The renderer shows the user the code and opens the verification URI
//!     in the system browser.
//!   - [`poll_device_token`] polls the provider's token endpoint until the
//!     user authorizes (or the flow errors/times out), then returns the
//!     access token.
//!
//! Only the public `client_id` is used; it is read from the process
//! environment and never crosses the IPC boundary. In dev, `reqy-web/.env.local`
//! is loaded as a non-overriding fallback so the desktop flow reuses the same
//! OAuth app as the legacy Next.js web routes.

use std::sync::OnceLock;

use reqwest::Client;
use serde::Deserialize;

use crate::error::AppError;

/// Providers supported by the native desktop OAuth flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OAuthProvider {
    Github,
    Gitlab,
}

impl OAuthProvider {
    /// Parse a provider name coming from the renderer.
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "github" => Ok(OAuthProvider::Github),
            "gitlab" => Ok(OAuthProvider::Gitlab),
            other => Err(AppError::InvalidInput(format!(
                "Unsupported OAuth provider: {other}"
            ))),
        }
    }

    /// Candidate env var pairs for the OAuth client credentials, in priority
    /// order. Desktop-specific vars win; the legacy Next.js web app's vars are
    /// used as a fallback (dev convenience when the same OAuth app is
    /// configured with a loopback callback URL).
    fn env_candidates(&self) -> [(&'static str, &'static str); 2] {
        match self {
            OAuthProvider::Github => [
                (
                    "GITHUB_OAUTH_DESKTOP_CLIENT_ID",
                    "GITHUB_OAUTH_DESKTOP_CLIENT_SECRET",
                ),
                ("GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"),
            ],
            OAuthProvider::Gitlab => [
                (
                    "GITLAB_OAUTH_DESKTOP_CLIENT_ID",
                    "GITLAB_OAUTH_DESKTOP_CLIENT_SECRET",
                ),
                ("GITLAB_OAUTH_CLIENT_ID", "GITLAB_OAUTH_CLIENT_SECRET"),
            ],
        }
    }

    /// Resolve the public `client_id` from the first candidate pair that is
    /// fully set.
    fn client_id(&self) -> Result<String, AppError> {
        load_env_fallback();
        let candidates = self.env_candidates();
        for (id_var, _) in candidates {
            if let Ok(id) = std::env::var(id_var) {
                return Ok(id);
            }
        }
        Err(AppError::InvalidInput(format!(
            "OAuth client id missing: set {} and {} (see reqy-web/.env.example)",
            candidates[0].0, candidates[0].1
        )))
    }

    /// Provider token-exchange endpoint.
    fn token_url(&self) -> &'static str {
        match self {
            OAuthProvider::Github => "https://github.com/login/oauth/access_token",
            OAuthProvider::Gitlab => "https://gitlab.com/oauth/token",
        }
    }

    /// Provider device-authorization endpoint (RFC 8628 step 1).
    fn device_authorization_url(&self) -> &'static str {
        match self {
            OAuthProvider::Github => "https://github.com/login/device/code",
            // GitLab's device flow endpoint is `/oauth/authorize_device`
            // (not `/oauth/authorize/device`).
            OAuthProvider::Gitlab => "https://gitlab.com/oauth/authorize_device",
        }
    }

    /// OAuth scopes for the device flow.
    fn scope(&self) -> &'static str {
        match self {
            OAuthProvider::Github => "repo read:user",
            OAuthProvider::Gitlab => "read_api read_user read_repository",
        }
    }
}

// ── Dev fallback: reuse the Next.js sidecar credentials ────────────────
//
// The web app keeps its OAuth credentials in `reqy-web/.env.local`, which the
// Rust process cannot read directly. Loading it as a fallback (never
// overriding variables that are already set) lets `pnpm tauri:dev` reuse the
// same GitHub/GitLab OAuth app without extra setup.

static ENV_LOADED: OnceLock<()> = OnceLock::new();

fn load_env_fallback() {
    let _ = ENV_LOADED.get_or_init(|| {
        if std::env::var("REQLY_SKIP_ENV_FALLBACK").is_ok() {
            return;
        }
        let candidates = [
            std::path::Path::new("reqy-web/.env.local").to_path_buf(),
            std::path::Path::new("../reqy-web/.env.local").to_path_buf(),
        ];
        for path in candidates {
            if path.exists() {
                log::warn!(
                    "[oauth] loading fallback env from {} — ensure this file does not contain production secrets",
                    path.display()
                );
                if dotenvy::from_path(&path).is_err() {
                    log::warn!("[oauth] failed to parse {}", path.display());
                }
                break;
            }
        }
    });
}

/// Response shape from the device-authorization endpoint (RFC 8628 step 1).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceFlowInit {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: i64,
    pub interval: i64,
}

/// Response shape accepted by both GitHub and GitLab token endpoints when
/// `Accept: application/json` is requested.
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

/// Ask the provider for a device code + user code (RFC 8628 step 1).
///
/// `device_authorization_url` is a parameter so unit tests can point the call
/// at a local mock server; the Tauri command passes
/// [`OAuthProvider::device_authorization_url`].
pub(crate) async fn start_device_flow(
    http: &Client,
    device_authorization_url: &str,
    provider: OAuthProvider,
) -> Result<DeviceFlowInit, AppError> {
    let client_id = provider.client_id()?;
    let params = [
        ("client_id", client_id.as_str()),
        ("scope", provider.scope()),
    ];

    let response = http
        .post(device_authorization_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await?;

    let status = response.status();
    let payload: DeviceFlowInit = response.json().await.map_err(|e| {
        AppError::Network(format!(
            "Invalid device authorization response (status {status}): {e}"
        ))
    })?;

    if payload.device_code.is_empty() || payload.user_code.is_empty() {
        return Err(AppError::Network(
            "Device authorization response missing device_code or user_code".to_string(),
        ));
    }
    Ok(payload)
}

/// Poll the token endpoint for the device flow (RFC 8628 step 3) until the
/// user authorizes.
///
/// Returns `Ok(access_token)` on success, or `Ok(None)` while the provider
/// reports `authorization_pending`. Terminal errors (denied, expired) and
/// provider errors surface as `Err`. `interval` follows the provider's
/// `slow_down` guidance.
///
/// `token_url` is a parameter so unit tests can point the exchange at a local
/// mock server; the Tauri command passes [`OAuthProvider::token_url`].
pub(crate) async fn poll_device_token(
    http: &Client,
    token_url: &str,
    provider: OAuthProvider,
    device_code: &str,
    interval: i64,
) -> Result<Option<String>, AppError> {
    let client_id = provider.client_id()?;

    let params = [
        ("client_id", client_id.as_str()),
        ("device_code", device_code),
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
    ];

    let response = http
        .post(token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await?;

    let status = response.status();
    let payload: TokenResponse = response
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Invalid token response (status {status}): {e}")))?;

    if let Some(access_token) = payload.access_token {
        return Ok(Some(access_token));
    }

    match payload.error.as_deref() {
        // Still waiting on the user — caller should retry after `interval`.
        Some("authorization_pending") => Ok(None),
        // Provider wants us to slow down polling.
        Some("slow_down") => {
            let slow = interval.saturating_add(5).max(interval);
            Err(AppError::Network(format!("slow_down:{slow}")))
        }
        Some("access_denied") => Err(AppError::Network(
            "OAuth authorization was denied by the user".to_string(),
        )),
        Some("expired_token") => Err(AppError::Network(
            "Device code expired; restart the authorization flow".to_string(),
        )),
        other => {
            let detail = payload
                .error_description
                .or_else(|| other.map(|e| e.to_string()))
                .unwrap_or_else(|| "OAuth provider rejected the device flow".to_string());
            Err(AppError::Network(format!(
                "OAuth device flow failed (status {status}): {detail}"
            )))
        }
    }
}

/// Tauri command: start the device flow and return the user code + verification
/// URI for the renderer to display. The `client_id` never crosses the IPC
/// boundary as a secret (it is public by design).
#[tauri::command]
pub async fn start_device_flow_cmd(
    state: tauri::State<'_, crate::fetch::SharedClient>,
    provider: String,
) -> Result<DeviceFlowInit, String> {
    let provider = OAuthProvider::parse(&provider).map_err(|e| e.to_string())?;
    start_device_flow(&state.normal, provider.device_authorization_url(), provider)
        .await
        .map_err(|e| e.to_string())
}

/// Tauri command: poll the provider's token endpoint once.
///
/// Returns `Ok(Some(token))` on success, `Ok(None)` while still pending, and
/// `Err` on terminal errors. The renderer drives the polling loop so it can
/// cancel when the user closes the dialog.
#[tauri::command]
pub async fn poll_device_token_cmd(
    state: tauri::State<'_, crate::fetch::SharedClient>,
    provider: String,
    device_code: String,
    interval: i64,
) -> Result<Option<String>, String> {
    let provider = OAuthProvider::parse(&provider).map_err(|e| e.to_string())?;
    poll_device_token(
        &state.normal,
        provider.token_url(),
        provider,
        &device_code,
        interval,
    )
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Mutex;

    use tiny_http::{ListenAddr, Response, Server};

    // Env vars are process-global, so tests that touch them must not run
    // concurrently with one another.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Point the provider at a local mock token endpoint.
    fn mock_token_url(server: &Server) -> String {
        let ListenAddr::IP(addr) = server.server_addr();
        format!("http://127.0.0.1:{}/token", addr.port())
    }

    /// Serve one request against the mock endpoint and capture the received
    /// form body so tests can assert what was sent.
    fn serve_one(server: Server, body: &'static str) -> std::thread::JoinHandle<String> {
        std::thread::spawn(move || {
            let mut request = server
                .incoming_requests()
                .next()
                .expect("mock server should receive a request");
            let mut form = String::new();
            request
                .as_reader()
                .read_to_string(&mut form)
                .expect("read request body");
            request
                .respond(Response::from_string(body))
                .expect("respond to request");
            form
        })
    }

    /// Serialise env manipulation and pin the provider credentials to
    /// sentinel values (fallback to `.env.local` is disabled for tests).
    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        let guard = ENV_LOCK.lock().expect("env lock");
        std::env::set_var("REQLY_SKIP_ENV_FALLBACK", "1");
        for (name, value) in [
            ("GITHUB_OAUTH_CLIENT_ID", "test-client-id"),
            ("GITHUB_OAUTH_CLIENT_SECRET", "test-client-secret"),
            ("GITLAB_OAUTH_CLIENT_ID", "test-gitlab-id"),
            ("GITLAB_OAUTH_CLIENT_SECRET", "test-gitlab-secret"),
        ] {
            std::env::set_var(name, value);
        }
        guard
    }

    #[test]
    fn parses_known_providers() {
        assert_eq!(
            OAuthProvider::parse("github").unwrap(),
            OAuthProvider::Github
        );
        assert_eq!(
            OAuthProvider::parse("gitlab").unwrap(),
            OAuthProvider::Gitlab
        );
    }

    #[test]
    fn rejects_unknown_provider() {
        assert!(OAuthProvider::parse("notion").is_err());
    }

    #[test]
    fn missing_credentials_is_a_descriptive_error() {
        let _guard = env_guard();
        for (name, _) in [
            (
                "GITHUB_OAUTH_DESKTOP_CLIENT_ID",
                "GITHUB_OAUTH_DESKTOP_CLIENT_SECRET",
            ),
            ("GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"),
        ] {
            std::env::remove_var(name);
        }
        let err = OAuthProvider::Github.client_id().unwrap_err();
        assert!(err.to_string().contains("GITHUB_OAUTH_DESKTOP_CLIENT_ID"));
    }

    #[tokio::test]
    async fn starts_device_flow_and_returns_user_code() {
        let _guard = env_guard();
        let server = Server::http("127.0.0.1:0").expect("bind mock server");
        let url = mock_token_url(&server);
        let form = serve_one(
            server,
            r#"{"device_code":"dc_123","user_code":"WDJB-MJHT","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
        );

        let init = start_device_flow(&Client::new(), &url, OAuthProvider::Github)
            .await
            .expect("device flow init should succeed");

        assert_eq!(init.device_code, "dc_123");
        assert_eq!(init.user_code, "WDJB-MJHT");
        assert_eq!(init.interval, 5);

        let body = form.join().expect("mock handler finished");
        assert!(body.contains("client_id=test-client-id"));
        // Form-urlencoding uses `+` for spaces: "repo read:user" → "repo+read%3Auser".
        assert!(body.contains("scope=repo+read%3Auser"));
        assert!(!body.contains("client_secret"));
    }

    #[tokio::test]
    async fn polls_device_token_until_user_authorizes() {
        let _guard = env_guard();
        let server = Server::http("127.0.0.1:0").expect("bind mock server");
        let url = mock_token_url(&server);
        let _form = serve_one(
            server,
            r#"{"access_token":"gho_mock-token","token_type":"bearer","scope":"repo"}"#,
        );

        let token = poll_device_token(&Client::new(), &url, OAuthProvider::Github, "dc_123", 5)
            .await
            .expect("poll should succeed");

        assert_eq!(token, Some("gho_mock-token".to_string()));
    }

    #[tokio::test]
    async fn pending_device_token_returns_none() {
        let _guard = env_guard();
        let server = Server::http("127.0.0.1:0").expect("bind mock server");
        let url = mock_token_url(&server);
        let _form = serve_one(server, r#"{"error":"authorization_pending"}"#);

        let token = poll_device_token(&Client::new(), &url, OAuthProvider::Github, "dc_123", 5)
            .await
            .expect("pending is not an error");

        assert_eq!(token, None);
    }

    #[tokio::test]
    async fn surfaces_provider_error_description() {
        let _guard = env_guard();
        let server = Server::http("127.0.0.1:0").expect("bind mock server");
        let url = mock_token_url(&server);
        let _form = serve_one(
            server,
            r#"{"error":"access_denied","error_description":"The user denied the request."}"#,
        );

        let err = poll_device_token(&Client::new(), &url, OAuthProvider::Gitlab, "dc_123", 5)
            .await
            .expect_err("access_denied should fail");

        assert!(err.to_string().contains("denied"));
    }
}
