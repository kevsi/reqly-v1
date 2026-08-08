//! Capture proxy — a local HTTP proxy that intercepts requests, emits them
//! to the frontend via `captured-request` / `captured-request-updated` events,
//! then forwards them to the upstream server.
//!
//! The server is implemented with `tiny_http` and runs on a dedicated std
//! thread with its own tokio runtime (so it can call `reqwest::Client`
//! async methods via `rt.block_on`). A shutdown atomic flag is shared
//! between the proxy thread and the Tauri command that stops it.

use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Request, Response, Server};
#[cfg(feature = "ts-export")]
use ts_rs::TS;
use uuid::Uuid;

use crate::error::AppError;
use crate::fetch::SharedClient;

/// Maximum response body size the capture proxy will forward (50 MB).
const MAX_RESPONSE_SIZE: usize = 50 * 1024 * 1024;

#[derive(Default)]
pub struct CaptureProxyState {
  pub shutdown_flag: Option<Arc<AtomicBool>>,
  pub server_thread: Option<std::thread::JoinHandle<()>>,
  /// Store the server's bound address so we can poke it on shutdown to unblock
  /// `incoming_requests()` (which blocks indefinitely waiting for a connection).
  pub server_addr: Option<SocketAddr>,
  /// Retained captured requests for the current (or last) capture session.
  /// Populated by the proxy thread after each forwarded request so the
  /// frontend can list/get them via Tauri commands. Persisted to disk (see
  /// `CAPTURE_FILE_PATH`) so captures survive an app restart.
  pub captured: Vec<CapturedRequest>,
  /// `true` once persisted captures have been loaded into `captured` (either
  /// from disk on first access, or because a capture session has started).
  /// Prevents `ensure_loaded` from clobbering in-memory captures mid-session.
  pub persisted_loaded: bool,
  /// Optional bandwidth cap (in ko/s) applied to forwarded response bodies.
  /// `None` disables throttling (default). Set via `set_bandwidth_limit`.
  pub bandwidth_limit_kbps: Option<u32>,
}

/// A reader that yields the given bytes but sleeps between reads to emulate a
/// constrained network link (bandwidth throttle). Used by `set_bandwidth_limit`.
///
/// The capture proxy runs on a dedicated std thread, so blocking sleeps here
/// are acceptable — they shape the rate at which the upstream response is
/// streamed back to the original caller.
struct ThrottledReader {
  data: Vec<u8>,
  pos: usize,
  bytes_per_sec: f64,
}

impl std::io::Read for ThrottledReader {
  fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
    if self.pos >= self.data.len() {
      return Ok(0);
    }
    let to_copy = std::cmp::min(buf.len(), self.data.len() - self.pos);
    if self.bytes_per_sec > 0.0 {
      let secs = (to_copy as f64) / self.bytes_per_sec;
      std::thread::sleep(std::time::Duration::from_secs_f64(secs));
    }
    buf[..to_copy].copy_from_slice(&self.data[self.pos..self.pos + to_copy]);
    self.pos += to_copy;
    Ok(to_copy)
  }
}

/// Lightweight view of a captured request, returned by `list_captured_sessions`.
#[derive(Serialize, Deserialize, Clone)]
#[cfg_attr(feature = "ts-export", derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", ts(export, rename_all = "camelCase"))]
pub struct CapturedSummary {
  pub id: String,
  pub method: String,
  pub url: String,
  pub timestamp: u64,
}

pub type ManagedCaptureProxyState = Arc<Mutex<CaptureProxyState>>;

// ── On-disk persistence (mirrors `store.rs` offline queue) ──────────────────
//
// Captured requests are persisted to `<app_data_dir>/captures.json` so they
// survive an app restart. We use a plain JSON file (serde camelCase) rather
// than a DB: capture volume is modest and the format stays trivially
// inspectable. The proxy thread writes the file after every captured request
// (cheap for typical volumes); `clear_captured_sessions` resets it.

static CAPTURE_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Point the capture store at the app's data directory. Call from Tauri
/// `setup` (next to `init_queue_store`) before any command runs.
pub fn init_capture_store(app_data_dir: PathBuf) {
  let _ = CAPTURE_FILE_PATH.set(app_data_dir.join("captures.json"));
}

fn read_captures_from(path: &Path) -> Vec<CapturedRequest> {
  match fs::read_to_string(path) {
    Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or_default(),
    _ => Vec::new(),
  }
}

fn write_captures_to(reqs: &[CapturedRequest], path: &Path) -> Result<(), AppError> {
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }
  let json = serde_json::to_string_pretty(reqs)?;
  fs::write(path, json)?;
  Ok(())
}

/// Read persisted captures (empty if uninitialised or the file is missing).
pub fn read_captures() -> Vec<CapturedRequest> {
  match CAPTURE_FILE_PATH.get() {
    Some(p) => read_captures_from(p),
    None => Vec::new(),
  }
}

/// Persist captures to disk (no-op if uninitialised).
pub fn write_captures(reqs: &[CapturedRequest]) -> Result<(), AppError> {
  match CAPTURE_FILE_PATH.get() {
    Some(p) => write_captures_to(reqs, p),
    None => Ok(()),
  }
}

/// Lazily load persisted captures into memory exactly once. Safe to call
/// before listing/getting so captures are visible even before the proxy is
/// started (e.g. after an app restart). No-op once `persisted_loaded` is set,
/// so in-memory captures are never clobbered during an active session.
fn ensure_loaded(state: &ManagedCaptureProxyState) {
  let mut guard = match state.lock() {
    Ok(g) => g,
    Err(_) => return,
  };
  if guard.persisted_loaded {
    return;
  }
  guard.captured = read_captures();
  guard.persisted_loaded = true;
}

#[derive(Serialize, Deserialize, Clone)]
#[cfg_attr(feature = "ts-export", derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", ts(export, rename_all = "camelCase"))]
pub struct CapturedRequest {
  pub id: String,
  pub method: String,
  pub url: String,
  pub headers: Vec<(String, String)>,
  pub body: Option<String>,
  pub timestamp: u64,
  // Response fields (populated after forwarding)
  pub status: Option<u16>,
  pub response_headers: Option<Vec<(String, String)>>,
  pub response_body: Option<String>,
  pub duration_ms: Option<u64>,
  pub error: Option<String>,
}

impl CapturedRequest {
  pub fn from_http_request(
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<String>,
  ) -> Self {
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap();
    CapturedRequest {
      id: format!("cap-{}", Uuid::new_v4()),
      method: method.to_string(),
      url: url.to_string(),
      headers: headers.to_vec(),
      body,
      timestamp: now.as_millis() as u64,
      status: None,
      response_headers: None,
      response_body: None,
      duration_ms: None,
      error: None,
    }
  }
}

/// Forward an HTTP request using reqwest (async, used inside proxy thread via rt.block_on).
async fn forward_request_async(
  client: &reqwest::Client,
  method: &str,
  url: &str,
  headers: &[(String, String)],
  body: Option<&str>,
) -> Result<(u16, Vec<(String, String)>, String), AppError> {
  let _parsed_url = reqwest::Url::parse(url)
    .map_err(|e| AppError::InvalidInput(format!("Invalid URL: {}", e)))?;

  // No SSRF blocking here — same rationale as fetch_proxy: Reqly is a
  // desktop client, testing local/LAN APIs is a core use case.

  let mut request = client
    .request(method.parse::<reqwest::Method>().map_err(|e| AppError::InvalidInput(e.to_string()))?, url);

  for (key, value) in headers {
    request = request.header(key, value);
  }

  if let Some(b) = body {
    request = request.body(reqwest::Body::from(b.to_string()));
  }

  let response = request.send().await?;
  let status = response.status().as_u16();
  let resp_headers: Vec<(String, String)> = response
    .headers()
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
    .collect();
  let response_body = response.bytes().await.map_err(|e| AppError::Network(e.to_string()))?;
  if response_body.len() > MAX_RESPONSE_SIZE {
    return Err(AppError::Network(format!(
      "Response body too large: {} bytes (max: {} bytes)",
      response_body.len(),
      MAX_RESPONSE_SIZE
    )));
  }
  let body_str = String::from_utf8(response_body.to_vec())
    .map_err(|e| AppError::Internal(format!("Response body is not valid UTF-8: {}", e)))?;

  Ok((status, resp_headers, body_str))
}

fn start_proxy_server(
  app_handle: AppHandle,
  port: u16,
  state: &ManagedCaptureProxyState,
  client: reqwest::Client,
) -> Result<(), AppError> {
  let addr = SocketAddr::from(([127, 0, 0, 1], port));
  let server = Server::http(addr).map_err(|e| AppError::Network(format!("Failed to bind port {}: {}", port, e)))?;

  let shutdown_flag = Arc::new(AtomicBool::new(false));
  let flag_for_server = shutdown_flag.clone();

  // Store server address so stop_capture_proxy can poke it.
  {
    let mut guard = state.lock()?;
    guard.shutdown_flag = Some(shutdown_flag);
    guard.server_addr = Some(addr);
  }

  // Spawn the blocking proxy loop in a std thread with a dedicated runtime
  let handle = app_handle.clone();
  // Clone the Arc so the proxy thread can retain captured requests.
  let captured_store = state.clone();
  let server_handle = std::thread::spawn(move || {
    let rt = match tokio::runtime::Runtime::new() {
      Ok(r) => r,
      Err(e) => {
        eprintln!("[capture-proxy] failed to create tokio runtime: {}", e);
        return;
      }
    };
    for mut request in server.incoming_requests() {
      if flag_for_server.load(Ordering::SeqCst) {
        break;
      }

      let method = request.method().to_string();
      let url = request.url().to_string();

      // Reconstruct full URL — if the request URL is a path, prepend http://127.0.0.1:port
      let full_url = if url.starts_with("http://") || url.starts_with("https://") {
        url.clone()
      } else {
        // Use Host header to determine target
        let host_header = request
          .headers()
          .iter()
          .find(|h| h.field.equiv("Host"))
          .map(|h| h.value.as_str())
          .unwrap_or("");

        // Default to http for the proxy
        let scheme = "http";
        format!("{}://{}{}", scheme, host_header, url)
      };

      let mut body_bytes: Option<Vec<u8>> = None;
      if method != "GET" && method != "HEAD" {
        let max_body: u64 = 10_485_760; // 10 MB cap
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut buf: Vec<u8> = Vec::new();
        let reader = request.as_reader();
        let mut chunk = [0u8; 8192];
        loop {
          if buf.len() >= max_body as usize {
            eprintln!("[capture-proxy] request body exceeds 10 MB, truncating");
            break;
          }
          if Instant::now() > deadline {
            eprintln!("[capture-proxy] request body read timed out after 30s");
            break;
          }
          match reader.read(&mut chunk) {
            Ok(0) => break, // EOF
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(e) => {
              eprintln!("[capture-proxy] error reading request body: {}", e);
              break;
            }
          }
        }
        if !buf.is_empty() {
          body_bytes = Some(buf);
        }
      }

      let body_str = body_bytes.as_ref().map(|b| String::from_utf8_lossy(b).to_string());

      // Build headers with validation — tiny_http::Header::from_bytes panics on
      // invalid header values. We validate and sanitize before building the
      // reqwest request to avoid thread death.
      let req_headers: Vec<(String, String)> = request
        .headers()
        .iter()
        .filter_map(|h| {
          let name = h.field.to_string();
          let value = h.value.as_str().to_string();
          // tiny_http's Header::from_bytes requires valid header names/values.
          // Filter out any that would panic (control chars, non-ASCII, etc.)
          if Header::from_bytes(name.as_bytes(), value.as_bytes()).is_ok() {
            Some((name, value))
          } else {
            eprintln!("[capture-proxy] dropped invalid header: {}: {}", name, value);
            None
          }
        })
        .collect();

      // Emit "captured" event (before forwarding)
      let mut captured =
        CapturedRequest::from_http_request(&method, &full_url, &req_headers, body_str.clone());

      let emit_result = handle.emit("captured-request", &captured);
      if emit_result.is_err() {
        eprintln!("[capture-proxy] failed to emit event: {:?}", emit_result);
      }

      // Forward the request
      let start = Instant::now();
      let forward_result = rt.block_on(forward_request_async(
        &client,
        &method,
        &full_url,
        &req_headers,
        body_str.as_deref(),
      ));

      let (status, resp_headers, resp_body) = match forward_result {
        Ok((s, h, b)) => (s, Some(h), Some(b)),
        Err(e) => {
          captured.error = Some(e.to_string());
          captured.duration_ms = Some(start.elapsed().as_millis() as u64);
          let _ = handle.emit("captured-request-updated", &captured);
          match tiny_http::Header::from_bytes(
            "Content-Type".as_bytes(),
            "text/plain".as_bytes(),
          ) {
            Ok(header) => {
              let _ = request.respond(
                Response::from_string(format!("Proxy error: {}", e))
                  .with_status_code(502)
                  .with_header(header),
              );
            }
            Err(err) => {
              eprintln!(
                "[capture-proxy] failed to create 502 Content-Type header: {:?}",
                err
              );
              let _ = request.respond(
                Response::from_string(format!("Proxy error: {}", e))
                  .with_status_code(502),
              );
            }
          };
          continue;
        }
      };

      captured.status = Some(status);
      captured.response_headers = resp_headers.clone();
      captured.response_body = resp_body.clone();
      captured.duration_ms = Some(start.elapsed().as_millis() as u64);

      let _ = handle.emit("captured-request-updated", &captured);

      // Retain the full request+response so it can be listed/gotten later,
      // and persist to disk so captures survive an app restart.
      if let Ok(mut g) = captured_store.lock() {
        g.captured.push(captured.clone());
        let _ = write_captures(&g.captured);
      }

      // Build tiny_http response headers — filter out invalid header entries
      // instead of unwrapping (which would panic the proxy thread).
      let http_resp_headers: Vec<Header> = resp_headers
        .unwrap_or_default()
        .iter()
        .filter(|(k, _)| !k.eq_ignore_ascii_case("transfer-encoding"))
        .filter(|(k, _)| !k.eq_ignore_ascii_case("content-encoding"))
        .filter_map(|(k, v)| {
          Header::from_bytes(k.as_bytes(), v.as_bytes()).ok()
        })
        .collect();

      // Read the current bandwidth cap (set via `set_bandwidth_limit`).
      // `captured_store` is the proxy state Arc shared with this thread.
      let limit_bps = captured_store
        .lock()
        .ok()
        .and_then(|g| g.bandwidth_limit_kbps)
        .map(|k| (k as f64) * 1024.0); // ko/s -> bytes/sec

      if let (Some(bps), Some(body)) = (limit_bps, resp_body.clone()) {
        // Throttled path — stream the response body with a sleep between chunks.
        let bytes = body.into_bytes();
        let total = bytes.len();
        let reader = ThrottledReader {
          data: bytes,
          pos: 0,
          bytes_per_sec: bps,
        };
        let _ = request.respond({
          let mut response = Response::new(
            tiny_http::StatusCode(status),
            Vec::new(),
            reader,
            Some(total),
            None,
          );
          for header in http_resp_headers.iter().cloned() {
            response = response.with_header(header);
          }
          response
        });
      } else {
        // Default path — unchanged behaviour.
        let _ = request.respond({
          let mut response = Response::from_string(resp_body.unwrap_or_default()).with_status_code(status);
          for header in http_resp_headers.iter().cloned() {
            response = response.with_header(header);
          }
          response
        });
      }
    }
  });

  let mut guard = state.lock()?;
  guard.server_thread = Some(server_handle);

  Ok(())
}

#[tauri::command]
pub fn start_capture_proxy(
  app_handle: AppHandle,
  port: u16,
  state: tauri::State<'_, ManagedCaptureProxyState>,
  client: tauri::State<'_, SharedClient>,
) -> Result<(), AppError> {
  if port < 1024 {
    return Err(AppError::InvalidInput("Port must be between 1024 and 65535".into()));
  }

  {
    let guard = state.lock()?;
    if guard.shutdown_flag.is_some() {
      return Err(AppError::AlreadyRunning("Capture proxy is already running".into()));
    }
  }

  // Load any previously persisted captures so history survives a restart.
  // Captures accumulate across sessions; use `clear_captured_sessions` to reset.
  ensure_loaded(&state);

  start_proxy_server(app_handle, port, &state, client.normal.clone())
}

#[tauri::command]
pub fn stop_capture_proxy(state: tauri::State<'_, ManagedCaptureProxyState>) -> Result<(), AppError> {
  let (flag, handle, server_addr) = {
    let mut guard = state.lock()?;
    let flag = guard.shutdown_flag.take();
    let handle = guard.server_thread.take();
    let server_addr = guard.server_addr.take();
    (flag, handle, server_addr)
  };

  if let Some(flag) = flag {
    flag.store(true, Ordering::SeqCst);
    // Wake up server.incoming_requests() which blocks waiting for a connection.
    if let Some(addr) = server_addr {
      let _ = std::net::TcpStream::connect(addr);
    }
    if let Some(handle) = handle {
      let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
      loop {
        if handle.is_finished() {
          match handle.join() {
            Ok(_) => return Ok(()),
            Err(_) => {
              eprintln!("[capture-proxy] proxy thread panicked");
              return Ok(());
            }
          }
        }
        if std::time::Instant::now() >= deadline {
          return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
      }
    }
    Ok(())
  } else {
    Err(AppError::NotRunning("Capture proxy is not running".into()))
  }
}

#[tauri::command]
pub fn list_captured_sessions(
  state: tauri::State<'_, ManagedCaptureProxyState>,
) -> Result<Vec<CapturedSummary>, AppError> {
  ensure_loaded(&state);
  let guard = state.lock()?;
  Ok(guard
    .captured
    .iter()
    .map(|c| CapturedSummary {
      id: c.id.clone(),
      method: c.method.clone(),
      url: c.url.clone(),
      timestamp: c.timestamp,
    })
    .collect())
}

#[tauri::command]
pub fn get_captured_session(
  id: String,
  state: tauri::State<'_, ManagedCaptureProxyState>,
) -> Result<Option<CapturedRequest>, AppError> {
  ensure_loaded(&state);
  let guard = state.lock()?;
  Ok(guard.captured.iter().find(|c| c.id == id).cloned())
}

#[tauri::command]
pub fn clear_captured_sessions(
  state: tauri::State<'_, ManagedCaptureProxyState>,
) -> Result<(), AppError> {
  {
    let mut guard = state.lock()?;
    guard.captured.clear();
    // Mark as loaded so `ensure_loaded` won't reload the just-cleared file.
    guard.persisted_loaded = true;
  }
  write_captures(&[])
}

#[tauri::command]
pub fn set_bandwidth_limit(
  kbps: Option<u32>,
  state: tauri::State<'_, ManagedCaptureProxyState>,
) -> Result<(), AppError> {
  if let Some(k) = kbps {
    if k == 0 {
      return Err(AppError::InvalidInput(
        "La limite de débit doit être > 0 ko/s ou null pour la désactiver".into(),
      ));
    }
  }
  let mut guard = state.lock()?;
  guard.bandwidth_limit_kbps = kbps;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn hdrs() -> Vec<(String, String)> {
    vec![("Content-Type".to_string(), "application/json".to_string())]
  }

  #[test]
  fn captured_request_has_unique_id() {
    let a = CapturedRequest::from_http_request("GET", "http://x", &hdrs(), None);
    let b = CapturedRequest::from_http_request("GET", "http://x", &hdrs(), None);
    assert_ne!(a.id, b.id);
    assert!(a.id.starts_with("cap-"));
  }

  #[test]
  fn captured_request_copies_method_url_headers() {
    let r = CapturedRequest::from_http_request("POST", "http://example.com/api", &hdrs(), Some("{}".to_string()));
    assert_eq!(r.method, "POST");
    assert_eq!(r.url, "http://example.com/api");
    assert_eq!(r.headers.len(), 1);
    assert_eq!(r.body.as_deref(), Some("{}"));
    assert!(r.status.is_none());
    assert!(r.error.is_none());
  }

  #[test]
  fn captured_request_timestamp_is_recent() {
    let before = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_millis() as u64;
    let r = CapturedRequest::from_http_request("GET", "http://x", &hdrs(), None);
    let after = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_millis() as u64;
    assert!(r.timestamp >= before);
    assert!(r.timestamp <= after);
  }

  #[test]
  fn capture_proxy_state_default_has_no_resources() {
    let state = CaptureProxyState::default();
    assert!(state.shutdown_flag.is_none());
    assert!(state.server_thread.is_none());
  }

  #[test]
  fn captures_round_trip_to_disk() {
    let dir = std::env::temp_dir()
      .join("reqly-capture-test")
      .join(uuid::Uuid::new_v4().to_string());
    let path = dir.join("captures.json");
    std::fs::create_dir_all(&dir).expect("create temp dir");

    let req = CapturedRequest::from_http_request("GET", "http://x", &hdrs(), None);
    write_captures_to(&[req.clone()], &path).expect("write captures");

    let loaded = read_captures_from(&path);
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, req.id);
    assert_eq!(loaded[0].method, "GET");
    assert_eq!(loaded[0].url, "http://x");
  }

  #[test]
  fn read_captures_handles_missing_file() {
    let missing = std::env::temp_dir()
      .join("reqly-capture-test")
      .join(uuid::Uuid::new_v4().to_string())
      .join("does-not-exist.json");
    assert!(read_captures_from(&missing).is_empty());
  }
}
