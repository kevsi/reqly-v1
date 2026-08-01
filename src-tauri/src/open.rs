//! External-link and file-export helpers.
//!
//! `open_external` whitelists a small set of URL schemes (http, https,
//! mailto) to prevent RCE via `file://`, `ms-settings:`, etc. `export_json`
//! writes the given content to a user-chosen file path via the dialog plugin.

use std::io::Write;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

use crate::error::AppError;

/// Writes arbitrary bytes to a user-chosen path.
///
/// Validates the path to prevent arbitrary file write. Rejects paths
/// containing path traversal components or pointing outside the user's
/// home directory, Downloads, or Documents.
#[tauri::command]
pub fn save_file(path: String, contents: Vec<u8>) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);

    // Reject path traversal
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(AppError::InvalidInput("Path traversal is not allowed".into()));
    }

    // Reject absolute paths outside allowed base directories
    if p.is_absolute() {
        let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let home = std::path::PathBuf::from(
            std::env::var(home_var).map_err(|_| AppError::Internal("Cannot determine home directory".into()))?,
        );
        let allowed = [
            home.as_path(),
            &home.join("Downloads"),
            &home.join("Documents"),
            &home.join("Desktop"),
        ];
        let canonical = if p.exists() { p.canonicalize().unwrap_or_else(|_| p.to_path_buf()) } else { p.to_path_buf() };
        let is_allowed = allowed.iter().any(|base| canonical.starts_with(base));
        if !is_allowed {
            return Err(AppError::InvalidInput("Save path must be under home, Downloads, Documents, or Desktop".into()));
        }
    }

    std::fs::write(&path, contents).map_err(|e| AppError::Io(e.to_string()))
}

/// Maximum size of exported JSON content (50 MB).
///
/// Prevents OOM from accidentally serialising very large datasets.
/// 50 MB is far beyond a reasonable collection export and is a
/// generous safety limit.
const MAX_EXPORT_SIZE: usize = 52_428_800; // 50 × 1024 × 1024

/// Validate export parameters before the dialog is opened.
///
/// Returns `Ok(())` if the parameters are acceptable, or an error
/// message explaining the problem.
fn validate_export(content: &str, default_name: &str) -> Result<(), AppError> {
  if content.len() > MAX_EXPORT_SIZE {
    return Err(AppError::InvalidInput(format!(
      "Export content too large ({} bytes). Maximum allowed is {} bytes.",
      content.len(),
      MAX_EXPORT_SIZE,
    )));
  }

  if default_name.is_empty() {
    return Err(AppError::InvalidInput("File name must not be empty.".into()));
  }

  Ok(())
}

#[tauri::command]
pub fn export_json(
  app: AppHandle,
  content: String,
  default_name: String,
) -> Result<String, AppError> {
  validate_export(&content, &default_name)?;

  let file_path: Option<FilePath> = app
    .dialog()
    .file()
    .add_filter("JSON", &["json"])
    .set_file_name(&default_name)
    .blocking_save_file();

  match file_path {
    Some(fp) => {
      let path = fp
        .into_path()
        .map_err(|e| AppError::InvalidInput(format!("Invalid file path: {}", e)))?;
      let mut opts = OpenOptions::new();
      opts.write(true).create(true).truncate(true);
      // `app.handle()` keeps the manager alive for the duration of the call
      let fs = app.fs();
      let mut file = fs.open(&path, opts).map_err(|e| AppError::Io(e.to_string()))?;
      file.write_all(content.as_bytes())?;
      Ok(path.to_string_lossy().to_string())
    }
    None => Err(AppError::Cancelled),
  }
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), AppError> {
  // SECURITY FIX H4: Whitelist allowed URL schemes to prevent RCE via file://, ms-settings:, etc.
  let scheme = url
    .split(':')
    .next()
    .unwrap_or("")
    .to_lowercase();

  let allowed_schemes = ["http", "https", "mailto"];

  if !allowed_schemes.contains(&scheme.as_str()) {
    return Err(AppError::InvalidInput(format!(
      "Blocked dangerous scheme: {}. Only http, https, mailto are allowed.",
      scheme
    )));
  }

  open::that(&url).map_err(|e| AppError::Network(e.to_string()))
}

#[cfg(test)]
mod tests {
  use super::validate_export;

  // ── export_json validation ───────────────────────────────────

  #[test]
  fn validate_rejects_empty_default_name() {
    let err = validate_export("{}", "").unwrap_err();
    assert!(err.to_string().contains("must not be empty"));
  }

  #[test]
  fn validate_accepts_small_content() {
    assert!(validate_export("{\"ok\":true}", "export.json").is_ok());
  }

  #[test]
  fn validate_rejects_content_exceeding_max_size() {
    // Build a string one byte over MAX_EXPORT_SIZE (52_428_801 bytes)
    let oversized = "X".repeat(super::MAX_EXPORT_SIZE + 1);
    let err = validate_export(&oversized, "export.json").unwrap_err();
    assert!(err.to_string().contains("too large"));
  }

  #[test]
  fn validate_accepts_content_at_max_size() {
    let at_limit = "Y".repeat(super::MAX_EXPORT_SIZE);
    assert!(validate_export(&at_limit, "export.json").is_ok());
  }

  // ── open_external scheme validation ──────────────────────────
  /// Mirror of the scheme whitelist; used to ensure tests cover every
  /// allowed/disallowed scheme combination.
  const ALLOWED: &[&str] = &["http", "https", "mailto"];

  fn is_allowed(url: &str) -> bool {
    let scheme = url.split(':').next().unwrap_or("").to_lowercase();
    ALLOWED.contains(&scheme.as_str())
  }

  #[test]
  fn http_url_is_allowed() {
    assert!(is_allowed("http://example.com"));
  }

  #[test]
  fn https_url_is_allowed() {
    assert!(is_allowed("https://example.com/path?q=1"));
  }

  #[test]
  fn mailto_url_is_allowed() {
    assert!(is_allowed("mailto:foo@example.com"));
  }

  #[test]
  fn file_scheme_is_blocked() {
    assert!(!is_allowed("file:///etc/passwd"));
  }

  #[test]
  fn ms_settings_scheme_is_blocked() {
    assert!(!is_allowed("ms-settings:network"));
  }

  #[test]
  fn javascript_scheme_is_blocked() {
    assert!(!is_allowed("javascript:alert(1)"));
  }

  #[test]
  fn uppercase_scheme_is_normalized() {
    assert!(is_allowed("HTTP://example.com"));
    assert!(is_allowed("HTTPS://example.com"));
    assert!(is_allowed("MAILTO:foo@example.com"));
  }

  #[test]
  fn malformed_url_is_blocked() {
    assert!(!is_allowed("not a url"));
  }
}
