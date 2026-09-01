//! External-link and file-export helpers.
//!
//! `open_external` whitelists a small set of URL schemes (http, https,
//! mailto) to prevent RCE via `file://`, `ms-settings:`, etc. `export_json`
//! writes the given content to a user-chosen file path via the dialog plugin.

use std::io::Write;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

use crate::error::{AppError, NetworkErrorKind};

/// Writes arbitrary bytes to a user-chosen path.
///
/// Validates the path to prevent arbitrary file write. Rejects paths
/// containing path traversal components or pointing outside the user's
/// home directory, Downloads, or Documents.
#[tauri::command]
pub fn save_file(path: String, contents: Vec<u8>) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);

    // Reject path traversal
    if contains_parent_dir(p) {
        return Err(AppError::InvalidInput(
            "Path traversal is not allowed".into(),
        ));
    }

    // Reject absolute paths outside allowed base directories
    if p.is_absolute() && !is_under_allowed_base(p)? {
        return Err(AppError::InvalidInput(
            "Save path must be under home, Downloads, Documents, or Desktop".into(),
        ));
    }

    std::fs::write(&path, contents).map_err(|e| AppError::Io(e.to_string()))
}

/// `true` if any component of `p` is a `..` parent-directory traversal.
fn contains_parent_dir(p: &std::path::Path) -> bool {
    p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
}

/// Windows `canonicalize` returns a verbatim `\\?\C:\...` prefix that breaks
/// component-wise `starts_with` comparison against the raw allowlist bases
/// (same issue handled by `is_system_directory` in `git/commands.rs`);
/// strip it so both sides of the comparison are comparable plain paths.
fn strip_verbatim_prefix(p: &std::path::Path) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => std::path::PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}

/// Resolve the deepest EXISTING ancestor of `p` via `canonicalize`, then
/// rebuild the candidate path as canonical ancestor + remaining (non-existent)
/// components.
///
/// SECURITY: validating the RAW path alone lets an attacker-created symlink
/// or junction on a not-yet-existing parent directory make `fs::write`
/// follow a target outside the allowlist. Rebuilding from the RESOLVED
/// ancestor ensures the real destination is what gets compared.
fn resolved_allowlist_candidate(p: &std::path::Path) -> Result<std::path::PathBuf, AppError> {
    let mut ancestor = p.to_path_buf();
    loop {
        if let Ok(canon) = std::fs::canonicalize(&ancestor) {
            let remaining = p
                .strip_prefix(&ancestor)
                .unwrap_or(std::path::Path::new(""));
            return Ok(strip_verbatim_prefix(&canon).join(remaining));
        }
        if !ancestor.pop() || ancestor.as_os_str().is_empty() {
            break;
        }
    }
    Err(AppError::Internal("Cannot resolve save path".into()))
}

/// Resolve an allowlist root the same way as the candidate (`canonicalize`
/// + verbatim-prefix strip) so both sides of the comparison are real paths:
/// this absorbs Windows 8.3 short names (e.g. `ALEXAN~1`), casing drift and
/// junctions/symlinks inside the roots themselves.
fn normalized_root(p: &std::path::Path) -> std::path::PathBuf {
    match std::fs::canonicalize(p) {
        Ok(canon) => strip_verbatim_prefix(&canon),
        Err(_) => strip_verbatim_prefix(p),
    }
}

/// `true` if `p` resolves under one of `allowed`.
fn is_under_allowed_roots(
    p: &std::path::Path,
    allowed: &[std::path::PathBuf],
) -> Result<bool, AppError> {
    let candidate = resolved_allowlist_candidate(p)?;
    Ok(allowed
        .iter()
        .any(|base| candidate.starts_with(normalized_root(base))))
}

/// `true` if `p` resolves under home, Downloads, Documents, or Desktop.
fn is_under_allowed_base(p: &std::path::Path) -> Result<bool, AppError> {
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = std::path::PathBuf::from(
        std::env::var(home_var)
            .map_err(|_| AppError::Internal("Cannot determine home directory".into()))?,
    );
    let allowed = [
        home.clone(),
        home.join("Downloads"),
        home.join("Documents"),
        home.join("Desktop"),
    ];
    is_under_allowed_roots(p, &allowed)
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
        return Err(AppError::InvalidInput(
            "File name must not be empty.".into(),
        ));
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
            let mut file = fs
                .open(&path, opts)
                .map_err(|e| AppError::Io(e.to_string()))?;
            file.write_all(content.as_bytes())?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Err(AppError::Cancelled),
    }
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), AppError> {
    // SECURITY FIX H4: Whitelist allowed URL schemes to prevent RCE via file://, ms-settings:, etc.
    let scheme = url.split(':').next().unwrap_or("").to_lowercase();

    let allowed_schemes = ["http", "https", "mailto"];

    if !allowed_schemes.contains(&scheme.as_str()) {
        return Err(AppError::InvalidInput(format!(
            "Blocked dangerous scheme: {}. Only http, https, mailto are allowed.",
            scheme
        )));
    }

    open::that(&url).map_err(|e| {
        AppError::network(
            NetworkErrorKind::Unknown,
            "Impossible dâ€™ouvrir le lien externe.",
            e.to_string(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::validate_export;
    use super::{contains_parent_dir, is_under_allowed_base, is_under_allowed_roots};
    use std::path::Path;

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

    // ── save_file path validation (SEC-6) ────────────────────────

    #[test]
    fn parent_dir_traversal_is_detected_cross_platform() {
        assert!(contains_parent_dir(Path::new("..")));
        assert!(contains_parent_dir(Path::new("../secret.txt")));
        assert!(contains_parent_dir(Path::new("docs/../../etc/passwd")));
        assert!(!contains_parent_dir(Path::new("docs/sub/file.txt")));
    }

    #[test]
    fn nonexistent_nested_path_under_documents_is_accepted() {
        let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let documents =
            std::path::PathBuf::from(std::env::var(home_var).unwrap()).join("Documents");
        if !documents.is_dir() {
            return; // environment without a Documents directory — skip
        }
        let target = documents
            .join("reqly-save-file-test")
            .join("nested")
            .join("out.json");
        assert!(!target.exists());
        assert!(
            is_under_allowed_base(&target).unwrap(),
            "{} must be accepted",
            target.display()
        );
    }

    #[test]
    fn path_outside_roots_is_rejected() {
        // %TEMP% may itself live under the user profile, so build an explicit
        // sandbox root and target a sibling path outside it.
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        let outside = tmp.path().join("elsewhere").join("file.json");

        assert!(!is_under_allowed_roots(&outside, &[root.clone()]).unwrap());
        // Sanity: a nested non-existent path under the root is accepted.
        assert!(is_under_allowed_roots(&root.join("nested").join("out.json"), &[root]).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_parent_escape_is_resolved_outside_allowlist() {
        use super::{normalized_root, resolved_allowlist_candidate};
        use std::os::unix::fs::symlink;

        let tmp = tempfile::TempDir::new().unwrap();
        let sandbox = tmp.path().join("sandbox");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&sandbox).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        // sandbox/link → outside: the RAW path stays under `sandbox`, but the
        // RESOLVED destination escapes it. This is the SEC-6 escape vector.
        let link = sandbox.join("link");
        symlink(&outside, &link).unwrap();

        // The final component does not exist, so only the symlinked ancestor
        // can reveal the real target.
        let raw_target = link.join("newfile.txt");
        assert!(!contains_parent_dir(&raw_target));

        let candidate = resolved_allowlist_candidate(&raw_target).unwrap();
        assert_eq!(
            candidate,
            normalized_root(&outside).join("newfile.txt"),
            "candidate must be rebuilt from the resolved ancestor"
        );
        assert!(
            !is_under_allowed_roots(&raw_target, &[sandbox.clone()]).unwrap(),
            "symlinked parent must not smuggle the target under the root"
        );
        // Control: a plain (non-symlinked) nested path stays allowed.
        assert!(is_under_allowed_roots(&sandbox.join("plain").join("ok.txt"), &[sandbox]).unwrap());
    }
}
