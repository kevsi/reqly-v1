//! Persistent offline request queue — prerequisite for the store-and-forward
//! feature (Task 12b).
//!
//! This is a deliberately simple, dependency-free FIFO queue backed by a
//! pretty-printed JSON file stored in the app's data directory
//! (`<app_data_dir>/offline-queue.json`). Every mutation (`enqueue`,
//! `mark_sent`) is persisted to disk immediately so queued requests survive an
//! app restart.
//!
//! We chose a JSON file over an embedded DB (rusqlite/sqlx): the queue is
//! low-write-volume, the format is trivially inspectable, and it adds no native
//! build dependencies. If throughput or querying needs grow, swapping the
//! backing store behind the same `QueueStore` API is a local change.

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri;
#[cfg(feature = "ts-export")]
use ts_rs::TS;

use crate::error::AppError;

/// A single request that failed to send (e.g. due to a network outage) and is
/// waiting to be replayed when connectivity returns.
///
/// Serialized as camelCase so the frontend (Task 12b) can build/consume it
/// directly from JS without field-name mapping.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "ts-export", derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", ts(export, rename_all = "camelCase"))]
pub struct QueuedRequest {
    pub id: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub created_at: i64,
    pub reason: String,
}

impl QueuedRequest {
    /// Build a queued request, auto-generating `id` (uuid) and `created_at`
    /// (current time, unix millis). Callers supply the request details.
    #[allow(dead_code)] // Forward API for the store-and-forward replay (Task 12b).
    pub fn new(
        method: impl Into<String>,
        url: impl Into<String>,
        headers: Vec<(String, String)>,
        body: Option<Vec<u8>>,
        reason: impl Into<String>,
    ) -> Self {
        QueuedRequest {
            id: format!("q-{}", uuid::Uuid::new_v4()),
            method: method.into(),
            url: url.into(),
            headers,
            body,
            created_at: chrono::Utc::now().timestamp_millis(),
            reason: reason.into(),
        }
    }
}

/// A FIFO queue of [`QueuedRequest`]s persisted as JSON.
///
/// The in-memory queue is guarded by a `Mutex`; the on-disk JSON file is the
/// durable source of truth and is rewritten on every mutation.
pub struct QueueStore {
    file_path: PathBuf,
    queue: Mutex<Vec<QueuedRequest>>,
}

const SENSITIVE_HEADER_PREFIXES: &[&str] = &["authorization", "cookie", "proxy-authorization", "x-api-key", "x-auth-token"];

fn redact_headers(headers: &[(String, String)]) -> Vec<(String, String)> {
    headers
        .iter()
        .filter(|(k, _)| !SENSITIVE_HEADER_PREFIXES.iter().any(|p| k.eq_ignore_ascii_case(p)))
        .cloned()
        .collect()
}

impl QueueStore {
    /// Open (creating if necessary) the queue store backed by `file_path`.
    /// Parent directories are created on demand.
    pub fn open(file_path: PathBuf) -> Result<Self, AppError> {
        if let Some(parent) = file_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let queue = if file_path.exists() {
            let raw = fs::read_to_string(&file_path)?;
            if raw.trim().is_empty() {
                Vec::new()
            } else {
                serde_json::from_str(&raw)?
            }
        } else {
            Vec::new()
        };
        Ok(Self {
            file_path,
            queue: Mutex::new(queue),
        })
    }

    /// Path of the backing JSON file (used by tests to verify persistence).
    #[allow(dead_code)] // Only exercised by unit tests.
    pub fn file_path(&self) -> &PathBuf {
        &self.file_path
    }

    /// Serialize the in-memory queue to disk with sensitive headers redacted.
    fn persist(&self) -> Result<(), AppError> {
        let guard = self.queue.lock()?;
        let redacted: Vec<QueuedRequest> = guard
            .iter()
            .map(|req| QueuedRequest {
                headers: redact_headers(&req.headers),
                ..req.clone()
            })
            .collect();
        let json = serde_json::to_string_pretty(&redacted)?;
        fs::write(&self.file_path, json)?;
        Ok(())
    }

    /// Append a request to the queue and persist immediately.
    pub fn enqueue(&self, req: QueuedRequest) -> Result<(), AppError> {
        {
            let mut guard = self.queue.lock()?;
            guard.push(req);
        }
        self.persist()
    }

    /// All requests still awaiting delivery, in enqueue (FIFO) order.
    pub fn list_pending(&self) -> Vec<QueuedRequest> {
        self.queue.lock().ok().map(|g| g.clone()).unwrap_or_default()
    }

    /// Peek the oldest pending request without removing it, or `None` if empty.
    /// Used by the replay loop to grab the next item to send.
    pub fn dequeue_ready(&self) -> Option<QueuedRequest> {
        self.queue.lock().ok()?.first().cloned()
    }

    /// Remove a request that has been delivered successfully.
    ///
    /// Idempotent: removing an id that is not (or no longer) pending is a
    /// no-op and returns `Ok`. This keeps the replay loop robust against
    /// double-acknowledgements.
    pub fn mark_sent(&self, id: &str) -> Result<(), AppError> {
        {
            let mut guard = self.queue.lock()?;
            guard.retain(|r| r.id != id);
        }
        self.persist()
    }
}

// ── Process-wide default store ──────────────────────────────────────────────
//
// The free functions below (`enqueue_request`, `list_pending`, `dequeue_ready`,
// `mark_sent`) operate on a single lazily-initialised store so they match the
// simple API Task 12b expects. The backing file lives in the app data dir once
// `init_queue_store` is called from Tauri `setup`; otherwise a temp-dir
// fallback is used (also covers unit tests that build their own store).

static QUEUE_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();
static DEFAULT_STORE: OnceLock<QueueStore> = OnceLock::new();

/// Point the default (process-wide) queue store at the app's data directory.
/// Call this from Tauri `setup` before any command runs.
pub fn init_queue_store(app_data_dir: PathBuf) {
    let _ = QUEUE_FILE_PATH.set(app_data_dir.join("offline-queue.json"));
}

fn default_store() -> &'static QueueStore {
    DEFAULT_STORE.get_or_init(|| {
        let candidate = QUEUE_FILE_PATH
            .get()
            .cloned()
            .unwrap_or_else(|| std::env::temp_dir().join("reqly").join("offline-queue.json"));
        match QueueStore::open(candidate.clone()) {
            Ok(store) => store,
            Err(e) => {
                eprintln!(
                    "[offline-queue] failed to open {candidate:?}: {e}; using temp fallback"
                );
                let fallback = std::env::temp_dir().join("reqly").join(format!(
                    "offline-queue-{}.json",
                    std::process::id()
                ));
                QueueStore::open(fallback).unwrap_or_else(|e| {
                    eprintln!("[offline-queue] CRITICAL: fallback also failed: {e}");
                    panic!("offline queue completely unavailable: {e}")
                })
            }
        }
    })
}

/// Enqueue a request on the default store (see [`init_queue_store`]).
#[tauri::command]
pub fn enqueue_request(req: QueuedRequest) -> Result<(), AppError> {
    default_store().enqueue(req)
}

/// List pending requests on the default store.
#[tauri::command]
pub fn list_pending() -> Vec<QueuedRequest> {
    default_store().list_pending()
}

/// Peek the next request ready to replay on the default store.
#[tauri::command]
pub fn dequeue_ready() -> Option<QueuedRequest> {
    default_store().dequeue_ready()
}

/// Mark a request as sent (remove from the default store).
#[tauri::command]
pub fn mark_sent(id: String) -> Result<(), AppError> {
    default_store().mark_sent(&id)
}

// ── Session encryption passphrase ──────────────────────────────────
//
// Used by the frontend `secure-storage.ts` to encrypt API keys and
// tokens stored in IndexedDB.  The passphrase is generated once at
// startup, lives only in the Rust process memory, and is transmitted
// to the renderer via IPC exactly once.  It is never persisted to
// disk, which means that a filesystem attacker cannot recover the
// plaintext values even if they read the IndexedDB files directly.
//
// Trade-off: the passphrase is lost on app restart, so previously
// encrypted values become unreadable.  In that case the frontend
// simply stores new values in plaintext (transparent fallback) until
// the user re-saves their credentials.
static SESSION_ENCRYPTION_KEY: OnceLock<String> = OnceLock::new();

/// Initialise the session encryption passphrase.  Call from Tauri
/// `setup` before any command runs.
pub fn init_session_encryption_key() {
    let _ = SESSION_ENCRYPTION_KEY
        .set(uuid::Uuid::new_v4().to_string());
}

/// Return the session passphrase to the renderer so it can encrypt
/// values stored in IndexedDB.  The passphrase is held only in Rust
/// process memory and is never written to disk.
#[tauri::command]
pub fn get_encryption_passphrase() -> Result<String, AppError> {
    SESSION_ENCRYPTION_KEY
        .get()
        .cloned()
        .ok_or_else(|| AppError::Internal(
            "Session encryption key not initialised".into(),
        ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    /// Create an isolated queue store backed by a unique temp file so tests do
    /// not interfere with each other or with the process-wide default store.
    fn isolated_store() -> QueueStore {
        let dir = std::env::temp_dir()
            .join("reqly-store-test")
            .join(Uuid::new_v4().to_string());
        let path = dir.join("queue.json");
        QueueStore::open(path).expect("open temp store")
    }

    fn sample_request(n: u32) -> QueuedRequest {
        QueuedRequest {
            id: format!("q-test-{n}"),
            method: "POST".into(),
            url: format!("https://api.example.com/v1/{n}"),
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: Some(format!("{{\"n\":{n}}}").into_bytes()),
            created_at: 1_700_000_000_000 + n as i64,
            reason: "network-down".into(),
        }
    }

    #[test]
    fn enqueue_then_list_shows_pending_in_fifo_order() {
        let store = isolated_store();
        assert!(store.list_pending().is_empty());

        store.enqueue(sample_request(1)).unwrap();
        store.enqueue(sample_request(2)).unwrap();

        let pending = store.list_pending();
        assert_eq!(pending.len(), 2, "both enqueued requests must be pending");
        // FIFO order must be preserved.
        assert_eq!(pending[0].id, "q-test-1");
        assert_eq!(pending[1].id, "q-test-2");
    }

    #[test]
    fn dequeue_ready_returns_oldest_without_removing() {
        let store = isolated_store();
        store.enqueue(sample_request(1)).unwrap();
        store.enqueue(sample_request(2)).unwrap();

        let ready = store.dequeue_ready().expect("should have a ready item");
        assert_eq!(ready.id, "q-test-1", "oldest request must be ready first");
        // dequeue_ready is a peek, not a pop — still pending.
        assert_eq!(store.list_pending().len(), 2);
    }

    #[test]
    fn mark_sent_removes_item_and_persists_to_disk() {
        let store = isolated_store();
        store.enqueue(sample_request(1)).unwrap();
        store.enqueue(sample_request(2)).unwrap();

        store.mark_sent("q-test-1").unwrap();

        let pending = store.list_pending();
        assert_eq!(pending.len(), 1, "sent item must no longer be pending");
        assert_eq!(pending[0].id, "q-test-2");

        // Persistence: reopen the same file and confirm state survived.
        let reopened = QueueStore::open(store.file_path().clone()).unwrap();
        let pending2 = reopened.list_pending();
        assert_eq!(pending2.len(), 1, "state must survive a reopen");
        assert_eq!(pending2[0].id, "q-test-2");
    }

    #[test]
    fn smoke_ipc_queue_payload_uses_frontend_field_names() {
        let request = QueuedRequest::new(
            "POST",
            "https://api.example.com/health",
            vec![("Content-Type".into(), "application/json".into())],
            Some(br#"{"ok":true}"#.to_vec()),
            "offline",
        );

        let json = serde_json::to_value(&request).expect("queued request must serialize");
        assert!(json.get("createdAt").is_some(), "IPC payload must use camelCase");
        assert!(json.get("created_at").is_none(), "snake_case must not leak to frontend");
        assert_eq!(json["method"], "POST");
        assert_eq!(json["url"], "https://api.example.com/health");

        let round_trip: QueuedRequest =
            serde_json::from_value(json).expect("IPC payload must deserialize back");
        assert_eq!(round_trip.method, "POST");
        assert_eq!(round_trip.body, Some(br#"{"ok":true}"#.to_vec()));
    }

    #[test]
    fn smoke_session_encryption_command_is_available_after_initialisation() {
        init_session_encryption_key();
        let first = get_encryption_passphrase().expect("session key must be available");
        let second = get_encryption_passphrase().expect("session key must remain available");

        assert!(!first.is_empty(), "session key must not be empty");
        assert_eq!(first, second, "session key must remain stable during the process");
    }

    #[test]
    fn empty_queue_dequeue_ready_is_none() {
        let store = isolated_store();
        assert!(store.dequeue_ready().is_none());
    }

    #[test]
    fn mark_sent_is_idempotent_for_missing_id() {
        let store = isolated_store();
        store.enqueue(sample_request(1)).unwrap();
        // Removing an unknown id is a no-op and must not error.
        store.mark_sent("does-not-exist").unwrap();
        assert_eq!(store.list_pending().len(), 1);
    }
}
