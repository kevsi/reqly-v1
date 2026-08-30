//! HTTP fetch proxy used by the desktop client.
//!
//! This module owns:
//!   - `TauriFetchResponse` (returned to the frontend)
//!   - `SharedClient` (reqwest client shared across commands)
//!   - `fetch_proxy` (the Tauri command invoked from JS)
//!   - `decode_html_entities` (post-processing of text bodies)
//!
//! Binary responses (image/*, audio/*, video/*, font/*, application/pdf,
//! application/octet-stream, application/zip, application/gzip) are returned
//! as base64 in `body` with `encoding: "base64"`. Text responses are decoded
//! as UTF-8 with HTML entities unescaped.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose, Engine as _};
use futures_util::stream;
use serde::Serialize;
use tauri;
#[cfg(feature = "ts-export")]
use ts_rs::TS;

use crate::error::AppError;

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", ts(export, rename_all = "camelCase"))]
pub struct TauriCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: String,
    pub expires: Option<String>,
}

#[derive(Serialize, Default, Clone)]
#[cfg_attr(feature = "ts-export", derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", ts(export, rename_all = "camelCase"))]
pub struct RequestTimings {
    pub dns_ms: u64,
    pub connect_ms: u64,
    pub tls_ms: u64,
    pub ttfb_ms: u64,
    pub transfer_ms: u64,
    pub upload_ms: u64,
    pub request_bytes: u64,
    pub response_bytes: u64,
    pub connection_reused: bool,
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", ts(export, rename_all = "camelCase"))]
pub struct TauriFetchResponse {
    pub status: u16,
    pub body: String,
    pub headers: Vec<(String, String)>,
    pub duration_ms: u64,
    pub encoding: String,
    pub cookies: Vec<TauriCookie>,
    pub timings: RequestTimings,
}

#[derive(Clone)]
pub struct SharedClient {
    pub normal: reqwest::Client,
    /// Variante qui NE suit PAS les redirections : le toggle followRedirects
    /// de l'UI doit être respecté (audit 25/08 — reqwest suivait toujours).
    pub normal_no_redirect: reqwest::Client,
    #[cfg(debug_assertions)]
    pub insecure: reqwest::Client,
    #[cfg(debug_assertions)]
    pub insecure_no_redirect: reqwest::Client,
}

/// Decode common HTML entities in response bodies.
///
/// Some upstream servers/frameworks encode characters like ' → &#x27; in JSON.
/// This also handles general numeric (`&#123;`) and hex (`&#x2F;`) HTML entities.
pub fn decode_html_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }

    // First pass: handle known named/short entities via simple replacement.
    let result = text
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&quot;", "\"")
        .replace("&#x22;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");

    // Second pass: handle general numeric (&#DECIMAL;) and hex (&#xHEX;) entities
    // that the simple replace chain above cannot cover (variable values).
    let mut out = String::with_capacity(result.len());
    let mut pos = 0;
    let s = result.as_str();

    while let Some(amp) = s[pos..].find('&') {
        // Copy everything before the ampersand.
        out.push_str(&s[pos..pos + amp]);
        let entity_start = pos + amp;

        // Find the closing semicolon.
        if let Some(semi) = s[entity_start..].find(';') {
            let body = &s[entity_start + 1..entity_start + semi]; // content between & and ;
            if let Some(c) = decode_numeric_entity(body) {
                out.push(c);
            } else {
                // Not a recognised numeric entity — keep the original text as-is.
                out.push_str(&s[entity_start..=entity_start + semi]);
            }
            pos = entity_start + semi + 1;
        } else {
            // No semicolon found — the & is literal, copy the rest.
            out.push_str(&s[entity_start..]);
            pos = s.len(); // signal the tail append to add nothing
            break;
        }
    }
    out.push_str(&s[pos..]);
    out
}

/// Try to decode a single numeric HTML entity (the part between `&` and `;`).
///
/// Supports decimal (`#123`) and hex (`#x2F`) forms.
/// Returns `None` if the entity is not a recognised numeric form.
fn decode_numeric_entity(entity: &str) -> Option<char> {
    if let Some(num) = entity.strip_prefix('#') {
        if let Ok(code) = num.parse::<u32>() {
            return char::from_u32(code);
        }
    }
    if let Some(hex) = entity.strip_prefix("#x") {
        if let Ok(code) = u32::from_str_radix(hex, 16) {
            return char::from_u32(code);
        }
    }
    None
}

fn is_binary_content_type(content_type: &str) -> bool {
    content_type.starts_with("image/")
        || content_type.starts_with("audio/")
        || content_type.starts_with("video/")
        || content_type.starts_with("font/")
        || content_type == "application/pdf"
        || content_type == "application/octet-stream"
        || content_type == "application/zip"
        || content_type == "application/gzip"
}

// SSRF protection is intentionally NOT enforced in the desktop client
// because Reqly is a local-first API client whose primary use-cases are
// testing local development servers (localhost, 10.x, 172.x, 192.168.x)
// and internal corporate APIs.  Blocking private IPs would break the core
// functionality of the application.
//
// The hosted web proxy (/api/proxy) DOES enforce SSRF protection for
// users who route through the cloud — see reqy-web/app/api/proxy/route.ts.

// ── Timing instrumentation ──────────────────────────────────────────────
// reqwest n'expose pas les phases réseau (DNS/TCP/TLS) ni l'instant où le
// body est entièrement envoyé. On mesure :
//   - DNS/TCP/TLS : probe concurrente (tokio net + tokio-rustls) sur une
//     connexion séparée, en parallèle de la vraie requête (comme le proxy web).
//   - Upload : body enveloppé dans un stream à un élément qui enregistre
//     l'instant où reqwest le consomme (≈ fin d'envoi).
//   - TTFB : `send()` ne résout qu'à l'arrivée des headers → instantané.
//   - Transfer : durée de lecture du corps de réponse.

/// Probe DNS + TCP (+ TLS si HTTPS) sur une connexion jetable, en ms.
async fn probe_connection(host: String, port: u16, https: bool) -> (u64, u64, u64) {
    let dns_start = Instant::now();
    let addr = tokio::net::lookup_host((host.as_str(), port))
        .await
        .ok()
        .and_then(|mut it| it.next());
    let dns_ms = dns_start.elapsed().as_millis() as u64;
    let Some(addr) = addr else {
        return (dns_ms, 0, 0);
    };

    let tcp_start = Instant::now();
    let socket = match tokio::net::TcpStream::connect(addr).await {
        Ok(s) => s,
        Err(_) => return (dns_ms, tcp_start.elapsed().as_millis() as u64, 0),
    };
    let tcp_ms = tcp_start.elapsed().as_millis() as u64;

    if !https {
        return (dns_ms, tcp_ms, 0);
    }

    let tls_start = Instant::now();
    let ok = probe_tls(host, socket).await;
    let tls_ms = tls_start.elapsed().as_millis() as u64;
    if ok.is_none() {
        return (dns_ms, tcp_ms, 0);
    }
    (dns_ms, tcp_ms, tls_ms)
}

/// Handshake TLS (tokio-rustls) sur une socket TCP déjà connectée.
async fn probe_tls(host: String, socket: tokio::net::TcpStream) -> Option<()> {
    let mut roots = rustls::RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().certs {
        let _ = roots.add(cert);
    }
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let name = rustls::pki_types::ServerName::try_from(host).ok()?;
    let _ = connector.connect(name, socket).await.ok()?;
    Some(())
}

#[tauri::command]
pub async fn fetch_proxy(
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    accept_invalid_certs: Option<bool>,
    // false = ne pas suivre les 3xx (surfacer la réponse de redirection).
    // Absent/true = comportement historique (reqwest suit, max 10 sauts).
    follow_redirects: Option<bool>,
    client: tauri::State<'_, SharedClient>,
) -> Result<TauriFetchResponse, AppError> {
    // Parse and validate URL
    let parsed_url = reqwest::Url::parse(&url)
        .map_err(|e| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

    // Validate URL scheme — block file://, javascript:, data:, ftp://, about:, blob:, etc.
    let scheme = parsed_url.scheme();
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return Err(AppError::InvalidInput(format!(
            "Blocked URL scheme: {}. Only http and https are allowed.",
            scheme
        )));
    }

    // Validate that a host is present.
    if parsed_url.host_str().is_none() {
        return Err(AppError::InvalidInput("Invalid URL: missing host".into()));
    }

    let start = Instant::now();
    let host = parsed_url.host_str().unwrap_or_default().to_string();
    let port = parsed_url.port_or_known_default().unwrap_or(80);
    let is_https = parsed_url.scheme() == "https";

    // Probe DNS + TCP + TLS en parallèle de la requête (comme le proxy web).
    let probe = tokio::spawn(probe_connection(host, port, is_https));

    // Track upload time via once-stream.
    let upload_done = Arc::new(Mutex::new(None::<Duration>));
    let request_bytes = body.as_ref().map(|b| b.len() as u64).unwrap_or(0);

    // Prevent SSL bypass via accept_invalid_certs in release builds.
    let mut accept_invalid_certs = accept_invalid_certs;
    if accept_invalid_certs == Some(true) {
        if cfg!(debug_assertions) {
            log::warn!("accept_invalid_certs is enabled; only use this in development");
        } else {
            log::warn!("accept_invalid_certs is not allowed in release builds; forcing to false");
            accept_invalid_certs = Some(false);
        }
    }

    #[cfg(debug_assertions)]
    let http_client = {
        let use_insecure = accept_invalid_certs.unwrap_or(false);
        let wants_redirects = follow_redirects.unwrap_or(true);
        match (use_insecure, wants_redirects) {
            (true, true) => &client.insecure,
            (true, false) => &client.insecure_no_redirect,
            (false, true) => &client.normal,
            (false, false) => &client.normal_no_redirect,
        }
    };
    #[cfg(not(debug_assertions))]
    let http_client = if follow_redirects.unwrap_or(true) {
        &client.normal
    } else {
        &client.normal_no_redirect
    };
    let mut request = http_client.request(
        method
            .parse::<reqwest::Method>()
            .map_err(|e| AppError::InvalidInput(e.to_string()))?,
        &url,
    );

    // Add headers
    let mut has_content_type = false;
    for (key, value) in headers {
        if key.eq_ignore_ascii_case("Content-Type") {
            has_content_type = true;
        }
        request = request.header(key, value);
    }

    // Force Content-Type if body and not already set
    if body.is_some() && !has_content_type {
        request = request.header("Content-Type", "application/json");
    }

    // Wrap body in a once-stream to measure upload time (reqwest consomme
    // le flux quand il est prêt à envoyer le body).
    if let Some(b) = body {
        let body_bytes = b.into_bytes();
        let upload_start = Instant::now();
        let done = Arc::clone(&upload_done);
        let stream = stream::once(async move {
            let mut guard = done.lock().unwrap();
            if guard.is_none() {
                *guard = Some(upload_start.elapsed());
            }
            drop(guard);
            Ok::<_, reqwest::Error>(bytes::Bytes::from(body_bytes))
        });
        request = request.body(reqwest::Body::wrap_stream(stream));
    }

    let response = request.send().await?;
    let ttfb_ms = start.elapsed().as_millis() as u64;
    let upload_ms = upload_done
        .lock()
        .unwrap()
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let status = response.status().as_u16();
    let header_pairs: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
        .collect();

    // Capture cookies from the Set-Cookie response headers before the body
    // is consumed (response.text()/bytes() moves the response).
    let cookies: Vec<TauriCookie> = response
        .cookies()
        .map(|c| {
            let expires = c.expires().map(|e| format!("{:?}", e));
            TauriCookie {
                name: c.name().to_string(),
                value: c.value().to_string(),
                domain: c.domain().unwrap_or_default().to_string(),
                path: c.path().unwrap_or_default().to_string(),
                secure: c.secure(),
                http_only: c.http_only(),
                same_site: "unknown".to_string(),
                expires,
            }
        })
        .collect();
    // Detect binary content types to encode as base64
    let content_type = header_pairs
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| {
            v.split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .to_lowercase()
        })
        .unwrap_or_default();

    let transfer_start = Instant::now();
    let (body_str, encoding, response_bytes) = if is_binary_content_type(&content_type) {
        let bytes = response
            .bytes()
            .await
            .map_err(AppError::from)?;
        let len = bytes.len() as u64;
        (
            general_purpose::STANDARD.encode(&bytes),
            "base64".to_string(),
            len,
        )
    } else {
        let text = response
            .text()
            .await
            .map_err(AppError::from)?;
        let len = text.len() as u64;
        // HTML entity decoding is only meaningful for HTML documents. Applying
        // it to JSON/XML/text corrupts legitimate data (e.g. `&#123;` inside a
        // JSON string becomes `{`).
        let decoded = if matches!(content_type.as_str(), "text/html" | "application/xhtml+xml") {
            decode_html_entities(&text)
        } else {
            text
        };
        (decoded, "utf8".to_string(), len)
    };
    let transfer_ms = transfer_start.elapsed().as_millis() as u64;

    let duration_ms = start.elapsed().as_millis() as u64;

    let (dns_ms, connect_ms, tls_ms) = probe.await.unwrap_or((0, 0, 0));
    let connection_reused = dns_ms + connect_ms < 5;

    let timings = RequestTimings {
        dns_ms,
        connect_ms,
        tls_ms,
        ttfb_ms,
        transfer_ms,
        upload_ms,
        request_bytes,
        response_bytes,
        connection_reused,
    };

    Ok(TauriFetchResponse {
        status,
        body: body_str,
        headers: header_pairs,
        duration_ms,
        encoding,
        cookies,
        timings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_html_entities_returns_input_when_no_entities() {
        assert_eq!(decode_html_entities("plain text"), "plain text");
        assert_eq!(decode_html_entities(""), "");
    }

    #[test]
    fn decode_html_entities_decodes_common_entities() {
        assert_eq!(decode_html_entities("a &#x27; b"), "a ' b");
        assert_eq!(decode_html_entities("a &#39; b"), "a ' b");
        assert_eq!(decode_html_entities("a &apos; b"), "a ' b");
        assert_eq!(decode_html_entities("a &quot; b"), "a \" b");
        assert_eq!(decode_html_entities("a &#x22; b"), "a \" b");
        assert_eq!(decode_html_entities("&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_html_entities("a &amp; b"), "a & b");
    }

    #[test]
    fn decode_html_entities_handles_json_payload() {
        let input = r#"{"name":"O&#x27;Brien"}"#;
        let expected = r#"{"name":"O'Brien"}"#;
        assert_eq!(decode_html_entities(input), expected);
    }

    #[test]
    fn decode_html_entities_does_not_touch_unknown_entities() {
        assert_eq!(decode_html_entities("a &unknown; b"), "a &unknown; b");
    }

    #[test]
    fn decode_html_entities_handles_numeric_entities() {
        assert_eq!(decode_html_entities("&#123;"), "{");
        assert_eq!(decode_html_entities("&#65;"), "A");
        assert_eq!(decode_html_entities("&#38;"), "&");
        assert_eq!(decode_html_entities("&#x27;"), "'"); // already handled in pass 1
    }

    #[test]
    fn decode_html_entities_handles_hex_entities() {
        assert_eq!(decode_html_entities("&#x2F;"), "/");
        assert_eq!(decode_html_entities("&#x41;"), "A");
        assert_eq!(decode_html_entities("&#x26;"), "&");
        assert_eq!(decode_html_entities("&#x22;"), "\""); // already handled in pass 1
        assert_eq!(decode_html_entities("&#x27;"), "'"); // already handled in pass 1
    }

    #[test]
    fn is_binary_content_type_classifies_correctly() {
        assert!(is_binary_content_type("image/png"));
        assert!(is_binary_content_type("image/jpeg"));
        assert!(is_binary_content_type("audio/mpeg"));
        assert!(is_binary_content_type("video/mp4"));
        assert!(is_binary_content_type("font/woff2"));
        assert!(is_binary_content_type("application/pdf"));
        assert!(is_binary_content_type("application/octet-stream"));
        assert!(is_binary_content_type("application/zip"));
        assert!(is_binary_content_type("application/gzip"));

        assert!(!is_binary_content_type("application/json"));
        assert!(!is_binary_content_type("text/html"));
        assert!(!is_binary_content_type(""));
    }
}
