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
use crate::error::{AppError, NetworkErrorKind};

use reqwest::Client;
use serde::Deserialize;

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
        AppError::network(
            NetworkErrorKind::MalformedResponse,
            format!("Invalid device authorization response (status {status})"),
            e.to_string(),
        )
    })?;

    if payload.device_code.is_empty() || payload.user_code.is_empty() {
        return Err(AppError::network(
            NetworkErrorKind::MalformedResponse,
            "Device authorization response missing device_code or user_code",
            "".to_string(),
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
        .map_err(|e| AppError::network(NetworkErrorKind::MalformedResponse, format!("Invalid token response (status {status})"), e.to_string()))?;

    if let Some(access_token) = payload.access_token {
        return Ok(Some(access_token));
    }

    match payload.error.as_deref() {
        // Still waiting on the user — caller should retry after `interval`.
        Some("authorization_pending") => Ok(None),
        // Provider wants us to slow down polling.
        Some("slow_down") => {
            let slow = interval.saturating_add(5).max(interval);
            Err(AppError::network(NetworkErrorKind::Unknown, format!("slow_down:{slow}"), "".to_string()))
        }
        Some("access_denied") => Err(AppError::network(
            NetworkErrorKind::Unknown,
            "OAuth authorization was denied by the user".to_string(),
            "".to_string(),
        )),
        Some("expired_token") => Err(AppError::network(
            NetworkErrorKind::Unknown,
            "Device code expired; restart the authorization flow".to_string(),
            "".to_string(),
        )),
        other => {
            let detail = payload
                .error_description
                .or_else(|| other.map(|e| e.to_string()))
                .unwrap_or_else(|| "OAuth provider rejected the device flow".to_string());
            Err(AppError::network(
                NetworkErrorKind::Unknown,
                format!("OAuth device flow failed (status {status})"),
                detail,
            ))
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

// ── Loopback OAuth server for GitHub login on desktop ────────────────────
// Starts a temporary local HTTP server that receives the GitHub OAuth
// callback, exchanges the code for a session, and emits the result to the
// frontend.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// Start a temporary local HTTP server on a random port that listens for the
/// GitHub OAuth callback. Returns the authorization URL to open in the browser.
#[tauri::command]
pub async fn start_github_oauth_server(
    app: AppHandle,
    client_id: String,
    sync_server_url: String,
) -> Result<String, String> {
    const OAUTH_PORT: u16 = 18234;
    let listener =
        TcpListener::bind(format!("127.0.0.1:{OAUTH_PORT}"))
            .map_err(|e| format!("Failed to bind loopback on port {OAUTH_PORT}: {e}. Is another instance running?"))?;
    log::info!("[oauth-loopback] Listening on port {OAUTH_PORT}");

    let redirect_uri = format!("http://127.0.0.1:{OAUTH_PORT}/callback");
    let state = uuid::Uuid::new_v4().to_string();

    // PKCE (RFC 7636) S256 challenge/verifier for the authorization-code
    // flow. 64 hex chars from two UUIDv4s: valid verifier charset & length.
    let code_verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let code_challenge = pkce_challenge(&code_verifier);

    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope=read%3Auser%20user%3Aemail&state={}&allow_signup=false&code_challenge={}&code_challenge_method=S256",
        client_id,
        urlencoding::encode(&redirect_uri),
        state,
        code_challenge,
    );

    let expected_state = state.clone();
    let sync_url = sync_server_url.clone();
    let redirect_uri_clone = redirect_uri.clone();
    let code_verifier_clone = code_verifier.clone();
    let auth_url_clone = auth_url.clone();

    // Emit the auth URL so the frontend can display it
    let _ = app.emit("github-oauth-url", &auth_url);

    // Handle connections in a background thread
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let _app_clone = app.clone();

    std::thread::spawn(move || {
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(300);
        let mut handled = false;

        listener
            .set_nonblocking(true)
            .expect("Failed to set non-blocking");

        while !handled && start.elapsed() < timeout {
            match listener.accept() {
                Ok((mut stream, _addr)) => {
                    let mut buf = [0u8; 4096];
                    let mut request = String::new();
                    loop {
                        match stream.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => {
                                request.push_str(&String::from_utf8_lossy(&buf[..n]));
                                if request.contains("\r\n\r\n") || request.contains("\n\n") {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }

                    let first_line = request.lines().next().unwrap_or("");
                    let path = first_line.split_whitespace().nth(1).unwrap_or("/");
                    log::info!("[oauth-loopback] Request: {path}");

                    if path.starts_with("/callback") {
                        let query = path.split('?').nth(1).unwrap_or("");
                        let params: HashMap<String, String> = query
                            .split('&')
                            .filter_map(|pair| {
                                let mut parts = pair.splitn(2, '=');
                                let key = parts.next()?.to_string();
                                let value =
                                    urlencoding::decode(parts.next().unwrap_or(""))
                                        .unwrap_or_default()
                                        .to_string();
                                Some((key, value))
                            })
                            .collect();

                        let code = params.get("code").cloned().unwrap_or_default();
                        let received_state =
                            params.get("state").cloned().unwrap_or_default();
                        let error = params.get("error").cloned().unwrap_or_default();

                        if !error.is_empty() {
                            send_response(&mut stream, 200, &error_page_html(&format!("GitHub a répondu : {error}")));
                            let _ = tx.send(format!("error:{error}"));
                            handled = true;
                        } else if !code.is_empty() {
                            if received_state == expected_state {
                                log::info!("[oauth-loopback] Exchanging code for session...");
                                match exchange_code_for_session(
                                    &sync_url,
                                    &code,
                                    &received_state,
                                    &redirect_uri_clone,
                                    &code_verifier_clone,
                                ) {
                                    Ok(user_data) => {
                                        send_response(&mut stream, 200, &success_page_html());
                                        let _ = tx.send(format!("success:{user_data}"));
                                    }
                                    Err(e) => {
                                        log::error!("[oauth-loopback] Exchange failed: {e}");
                                        send_response(&mut stream, 200, &error_page_html(&e));
                                        let _ = tx.send(format!("error:{e}"));
                                    }
                                }
                                handled = true;
                            } else {
                                send_response(
                                    &mut stream,
                                    200,
                                    &error_page_html("Vérification de sécurité échouée (state invalide). Fermez cette fenêtre et réessayez."),
                                );
                                let _ = tx.send("error:state_mismatch".to_string());
                                handled = true;
                            }
                        } else {
                            send_response(
                                &mut stream,
                                200,
                                &error_page_html("Aucun code d'autorisation n'a été reçu de GitHub."),
                            );
                            let _ = tx.send("error:no_code".to_string());
                            handled = true;
                        }
                    } else {
                        // Redirect to GitHub auth
                        let body = format!("<html><body><p>Redirection en cours...</p><script>window.location.href='{auth_url_clone}';</script></body></html>");
                        send_response(&mut stream, 200, &body);
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(e) => {
                    log::error!("[oauth-loopback] Accept error: {e}");
                    break;
                }
            }
        }

        if !handled {
            let _ = tx.send("error:timeout".to_string());
        }
    });

    // Wait for the result and emit events to the frontend
    let app_for_emit = app.clone();
    std::thread::spawn(move || {
        if let Ok(result) = rx.recv_timeout(Duration::from_secs(310)) {
            if result.starts_with("success:") {
                let data = result.strip_prefix("success:").unwrap_or("");
                let _ = app_for_emit.emit("github-oauth-complete", data.to_string());
            } else if result.starts_with("error:") {
                let error = result.strip_prefix("error:").unwrap_or("unknown");
                let _ = app_for_emit.emit("github-oauth-error", error.to_string());
            }
        }
    });

    Ok(auth_url)
}

/// Escape a string for safe interpolation into HTML content.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

const LOOPBACK_PAGE_CSS: &str = r#"
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #ecfdf5 0%, #f0fdfa 55%, #d1fae5 100%);
    padding: 24px;
  }
  .card {
    background: #ffffff;
    border-radius: 20px;
    padding: 44px 40px 36px;
    max-width: 400px;
    width: 100%;
    text-align: center;
    box-shadow: 0 24px 60px rgba(5,150,105,.16), 0 4px 14px rgba(0,0,0,.06);
    animation: rise .55s cubic-bezier(.22,1,.36,1) both;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
  .badge {
    width: 84px; height: 84px; margin: 0 auto 22px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    animation: pop .45s cubic-bezier(.34,1.56,.64,1) .15s both;
  }
  .badge.ok   { background: linear-gradient(135deg, #10b981, #047857); box-shadow: 0 14px 30px rgba(16,185,129,.35); }
  .badge.fail { background: linear-gradient(135deg, #f87171, #dc2626); box-shadow: 0 14px 30px rgba(239,68,68,.3); }
  @keyframes pop { from { transform: scale(.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .badge svg path {
    stroke-dasharray: 48; stroke-dashoffset: 48;
    animation: draw .4s ease-out .5s forwards;
  }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  h1 { font-size: 21px; color: #111827; letter-spacing: -0.02em; margin-bottom: 8px; }
  p.desc { font-size: 14px; color: #6b7280; line-height: 1.55; }
  p.err {
    font-size: 13px; color: #b91c1c; background: #fef2f2;
    border: 1px solid #fee2e2; border-radius: 10px;
    padding: 10px 14px; margin-top: 14px;
    word-break: break-word; text-align: left;
  }
  .brand {
    margin-top: 26px; padding-top: 20px;
    border-top: 1px solid #f3f4f6;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .logo {
    width: 26px; height: 26px; border-radius: 8px;
    background: linear-gradient(135deg, #10b981, #047857);
    color: #fff; font-weight: 800; font-size: 13px;
    display: flex; align-items: center; justify-content: center;
  }
  .brand span { font-weight: 700; color: #111827; font-size: 14px; letter-spacing: -0.01em; }
  .dots { display: inline-flex; gap: 4px; margin-left: 6px; vertical-align: middle; }
  .dots i { width: 4px; height: 4px; border-radius: 50%; background: #10b981; animation: blink 1.1s infinite; }
  .dots i:nth-child(2) { animation-delay: .2s; }
  .dots i:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
"#;

fn page_shell(title: &str, badge_class: &str, icon_svg: &str, heading: &str, desc_html: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Reqly</title>
<style>{css}</style>
</head>
<body>
<div class="card">
  <div class="badge {badge_class}">{icon_svg}</div>
  <h1>{heading}</h1>
  {desc_html}
  <div class="brand"><div class="logo">R</div><span>Reqly</span></div>
</div>
</body>
</html>"#,
        title = html_escape(title),
        css = LOOPBACK_PAGE_CSS,
        badge_class = badge_class,
        icon_svg = icon_svg,
        heading = heading,
        desc_html = desc_html,
    )
}

fn success_page_html() -> String {
    let check = r##"<svg width="38" height="38" viewBox="0 0 24 24" fill="none"><path d="M4.5 12.5l5 5L19.5 6.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>"##;
    let mut html = page_shell(
        "Connexion réussie",
        "ok",
        check,
        "Connexion réussie !",
        r#"<p class="desc">Vous êtes connecté. Retour automatique à l'application<span class="dots"><i></i><i></i><i></i></span></p>"#,
    );
    // Best-effort tab close — works on tabs launched from an external app.
    html.push_str(r#"<script>setTimeout(function(){ window.close(); }, 2200);</script>"#);
    html
}

fn error_page_html(message: &str) -> String {
    let cross = r##"<svg width="38" height="38" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7L7 17" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>"##;
    page_shell(
        "Erreur de connexion",
        "fail",
        cross,
        "La connexion a échoué",
        &format!(
            r#"<p class="desc">Impossible de finaliser la connexion GitHub.</p><p class="err">{msg}</p><p class="desc" style="margin-top:14px">Vous pouvez fermer cette fenêtre et réessayer.</p>"#,
            msg = html_escape(message),
        ),
    )
}

fn send_response(stream: &mut impl Write, status: u16, body: &str) {
    let status_text = match status {
        200 => "OK",
        _ => "Unknown",
    };
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// S256 PKCE challenge = base64url(SHA-256(verifier)), unpadded per RFC 7636.
fn pkce_challenge(verifier: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

fn exchange_code_for_session(
    sync_url: &str,
    code: &str,
    state: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;

    // Exchange code for GitHub access token via sync-server
    let exchange_url = format!(
        "{}/api/auth/github-exchange",
        sync_url.trim_end_matches('/')
    );
    let resp = client
        .post(&exchange_url)
        .json(&serde_json::json!({
            "code": code,
            "state": state,
            "redirect_uri": redirect_uri,
            // PKCE verifier — required because the flow used S256 challenge.
            "code_verifier": code_verifier,
        }))
        .send()
        .map_err(|e| format!("github-exchange: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("github-exchange: {}", resp.text().unwrap_or_default()));
    }
    let data: serde_json::Value = resp.json().map_err(|e| format!("parse exchange: {e}"))?;
    let access_token = data["access_token"]
        .as_str()
        .ok_or("No access_token in response")?;

    // Fetch GitHub user profile (User-Agent is REQUIRED by the GitHub API)
    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "reqly-desktop")
        .send()
        .map_err(|e| format!("GitHub user: {e}"))?;
    let github_user: serde_json::Value =
        user_resp.json().map_err(|e| format!("parse user: {e}"))?;
    let github_id = github_user["id"]
        .as_i64()
        .ok_or("No GitHub id")?;
    let login = github_user["login"].as_str().unwrap_or("unknown");

    // Get email (might be private)
    let mut email = github_user["email"].as_str().map(String::from);
    if email.is_none() {
        let emails_resp = client
            .get("https://api.github.com/user/emails")
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "reqly-desktop")
            .send()
            .map_err(|e| format!("GitHub emails: {e}"))?;
        let emails: Vec<serde_json::Value> =
            emails_resp.json().map_err(|e| format!("parse emails: {e}"))?;
        email = emails
            .iter()
            .find(|e| {
                e["primary"].as_bool() == Some(true) && e["verified"].as_bool() == Some(true)
            })
            .or_else(|| emails.iter().find(|e| e["verified"].as_bool() == Some(true)))
            .and_then(|e| e["email"].as_str())
            .map(String::from);
    }
    let email = email.ok_or("No verified email found")?;
    let name = github_user["name"].as_str().unwrap_or(login);

    // Login via sync-server
    let login_url = format!(
        "{}/api/auth/oauth-login",
        sync_url.trim_end_matches('/')
    );
    let login_resp = client
        .post(&login_url)
        .json(&serde_json::json!({
            "provider": "github",
            "providerId": github_id.to_string(),
            "email": email,
            "name": name,
            // The sync-server validates this token against api.github.com/user
            // before issuing a session.
            "accessToken": access_token,
        }))
        .send()
        .map_err(|e| format!("oauth-login: {e}"))?;

    if !login_resp.status().is_success() {
        return Err(format!(
            "oauth-login: {}",
            login_resp.text().unwrap_or_default()
        ));
    }

    let login_data: serde_json::Value =
        login_resp.json().map_err(|e| format!("parse login: {e}"))?;
    Ok(login_data.to_string())
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
        match server.server_addr() {
            ListenAddr::IP(addr) => format!("http://127.0.0.1:{}/token", addr.port()),
            ListenAddr::Unix(_) => panic!("mock OAuth server must listen on TCP"),
        }
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
