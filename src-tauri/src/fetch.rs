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

use std::time::Instant;

use base64::{Engine as _, engine::general_purpose};
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
}

#[derive(Clone)]
pub struct SharedClient {
  pub normal: reqwest::Client,
  #[cfg(debug_assertions)]
  pub insecure: reqwest::Client,
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

#[tauri::command]
pub async fn fetch_proxy(
  method: String,
  url: String,
  headers: Vec<(String, String)>,
  body: Option<String>,
  accept_invalid_certs: Option<bool>,
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
  let http_client = if accept_invalid_certs.unwrap_or(false) {
    &client.insecure
  } else {
    &client.normal
  };
  #[cfg(not(debug_assertions))]
  let http_client = &client.normal;
  let mut request = http_client
    .request(method.parse::<reqwest::Method>().map_err(|e| AppError::InvalidInput(e.to_string()))?, &url);

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

  if let Some(body) = body {
    request = request.body(body);
  }

  let response = request.send().await?;
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
      let expires = c
        .expires()
        .map(|e| format!("{:?}", e));
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
    .map(|(_, v)| v.split(';').next().unwrap_or_default().trim().to_lowercase())
    .unwrap_or_default();

  let (body_str, encoding) = if is_binary_content_type(&content_type) {
    let bytes = response.bytes().await.map_err(|e| AppError::Network(e.to_string()))?;
    (general_purpose::STANDARD.encode(&bytes), "base64".to_string())
  } else {
    let text = response.text().await.map_err(|e| AppError::Network(e.to_string()))?;
    // HTML entity decoding is only meaningful for HTML documents. Applying
    // it to JSON/XML/text corrupts legitimate data (e.g. `&#123;` inside a
    // JSON string becomes `{`).
    let decoded = if matches!(content_type.as_str(), "text/html" | "application/xhtml+xml") {
      decode_html_entities(&text)
    } else {
      text
    };
    (decoded, "utf8".to_string())
  };

  let duration_ms = start.elapsed().as_millis() as u64;

  Ok(TauriFetchResponse {
    status,
    body: body_str,
    headers: header_pairs,
    duration_ms,
    encoding,
    cookies,
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
    assert_eq!(decode_html_entities("&#x27;"), "'");   // already handled in pass 1
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
