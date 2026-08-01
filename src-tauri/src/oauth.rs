//! OAuth token exchange for GitHub / GitLab.
//!
//! The desktop authorization-code flow is split across both processes:
//!   - the renderer starts a temporary localhost server via
//!     `tauri-plugin-oauth`, opens the provider's authorize URL in the system
//!     browser, and captures the redirect that contains the one-time `code`;
//!   - [`exchange_oauth_code`] (this module) trades that `code` for an access
//!     token. The OAuth client ID/secret are read from the process environment
//!     and never cross the IPC boundary, keeping them out of the renderer.
//!
//! In dev the web app's `reqy-web/.env.local` is loaded as a non-overriding
//! fallback so the desktop flow reuses the same credentials as the legacy
//! Next.js OAuth routes. In a packaged build the credentials must be present
//! in the environment that launches the app (or the command returns a
//! descriptive error).

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
                ("GITHUB_OAUTH_DESKTOP_CLIENT_ID", "GITHUB_OAUTH_DESKTOP_CLIENT_SECRET"),
                ("GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"),
            ],
            OAuthProvider::Gitlab => [
                ("GITLAB_OAUTH_DESKTOP_CLIENT_ID", "GITLAB_OAUTH_DESKTOP_CLIENT_SECRET"),
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

    /// Load the OAuth client credentials from the environment (see the module
    /// docs for the dev fallback).
    fn credentials(&self) -> Result<(String, String), AppError> {
        load_env_fallback();
        let candidates = self.env_candidates();
        for (id_var, secret_var) in candidates {
            if let (Ok(id), Ok(secret)) = (std::env::var(id_var), std::env::var(secret_var)) {
                return Ok((id, secret));
            }
        }
        let (id_var, secret_var) = candidates[0];
        Err(AppError::InvalidInput(format!(
            "OAuth credentials missing: set {id_var} and {secret_var}"
        )))
    }

    /// Provider token-exchange endpoint.
    fn token_url(&self) -> &'static str {
        match self {
            OAuthProvider::Github => "https://github.com/login/oauth/access_token",
            OAuthProvider::Gitlab => "https://gitlab.com/oauth/token",
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
        // Tests set this to avoid pulling real credentials from .env.local
        // into the test process.
        if std::env::var("REQLY_SKIP_ENV_FALLBACK").is_ok() {
            return;
        }
        // Covers running `pnpm tauri:dev` from the repo root or from
        // `src-tauri/` (the CWD the Tauri CLI uses for the spawned app).
        let candidates = [
            std::path::Path::new("reqy-web/.env.local").to_path_buf(),
            std::path::Path::new("../reqy-web/.env.local").to_path_buf(),
        ];
        for path in candidates {
            if path.exists() {
                if dotenvy::from_path(&path).is_err() {
                    log::warn!("[oauth] failed to parse {}", path.display());
                }
                break;
            }
        }
    });
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

/// Exchange an authorization `code` for an access token.
///
/// `token_url` is a parameter so unit tests can point the exchange at a local
/// mock server; the Tauri command passes [`OAuthProvider::token_url`].
pub(crate) async fn exchange_access_token(
    http: &Client,
    token_url: &str,
    provider: OAuthProvider,
    code: &str,
    redirect_uri: &str,
) -> Result<String, AppError> {
    let (client_id, client_secret) = provider.credentials()?;

    let params = [
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
    ];

    let response = http
        .post(token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await?;

    let status = response.status();
    let payload: TokenResponse = response.json().await.map_err(|e| {
        AppError::Network(format!("Invalid token response (status {status}): {e}"))
    })?;

    if let Some(access_token) = payload.access_token {
        return Ok(access_token);
    }

    let detail = payload
        .error_description
        .or(payload.error)
        .unwrap_or_else(|| "OAuth provider rejected the authorization code".to_string());
    Err(AppError::Network(format!(
        "OAuth token exchange failed (status {status}): {detail}"
    )))
}

/// Tauri command: exchange the OAuth `code` captured by the renderer for an
/// access token. Client credentials never cross the IPC boundary.
#[tauri::command]
pub async fn exchange_oauth_code(
    state: tauri::State<'_, crate::fetch::SharedClient>,
    provider: String,
    code: String,
    redirect_uri: String,
) -> Result<String, String> {
    let provider = OAuthProvider::parse(&provider).map_err(|e| e.to_string())?;
    exchange_access_token(&state.normal, provider.token_url(), provider, &code, &redirect_uri)
        .await
        .map_err(|e| e.to_string())
}

/// Tauri command: return the public OAuth `client_id` for a provider so the
/// renderer can build the authorization URL. The `client_secret` never
/// crosses the IPC boundary.
#[tauri::command]
pub fn get_oauth_client_id(provider: String) -> Result<String, String> {
    let provider = OAuthProvider::parse(&provider).map_err(|e| e.to_string())?;
    provider.client_id().map_err(|e| e.to_string())
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
        assert_eq!(OAuthProvider::parse("github").unwrap(), OAuthProvider::Github);
        assert_eq!(OAuthProvider::parse("gitlab").unwrap(), OAuthProvider::Gitlab);
    }

    #[test]
    fn rejects_unknown_provider() {
        assert!(OAuthProvider::parse("notion").is_err());
    }

    #[test]
    fn missing_credentials_is_a_descriptive_error() {
        let _guard = env_guard();
        for (name, _) in [
            ("GITHUB_OAUTH_DESKTOP_CLIENT_ID", "GITHUB_OAUTH_DESKTOP_CLIENT_SECRET"),
            ("GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"),
        ] {
            std::env::remove_var(name);
        }
        let err = OAuthProvider::Github.credentials().unwrap_err();
        assert!(err.to_string().contains("GITHUB_OAUTH_DESKTOP_CLIENT_ID"));
    }

    #[tokio::test]
    async fn exchanges_code_and_returns_access_token() {
        let _guard = env_guard();
        let server = Server::http("127.0.0.1:0").expect("bind mock server");
        let url = mock_token_url(&server);
        let form = serve_one(
            server,
            r#"{"access_token":"gho_mock-token","token_type":"bearer","scope":"repo"}"#,
        );

        let token = exchange_access_token(
            &Client::new(),
            &url,
            OAuthProvider::Github,
            "mock-auth-code",
            "http://127.0.0.1:8123",
        )
        .await
        .expect("exchange should succeed");

        assert_eq!(token, "gho_mock-token");

        let body = form.join().expect("mock handler finished");
        assert!(body.contains("client_id=test-client-id"));
        assert!(body.contains("client_secret=test-client-secret"));
        assert!(body.contains("code=mock-auth-code"));
        assert!(body.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8123"));
        assert!(body.contains("grant_type=authorization_code"));
    }

    #[tokio::test]
    async fn surfaces_provider_error_description() {
        let _guard = env_guard();
        let server = Server::http("127.0.0.1:0").expect("bind mock server");
        let url = mock_token_url(&server);
        let _form = serve_one(
            server,
            r#"{"error":"bad_verification_code","error_description":"The code passed is incorrect or expired."}"#,
        );

        let err = exchange_access_token(
            &Client::new(),
            &url,
            OAuthProvider::Gitlab,
            "bad-code",
            "http://127.0.0.1:8123",
        )
        .await
        .expect_err("exchange should fail");

        assert!(err.to_string().contains("incorrect or expired"));
    }
}
