//! Backend route analysis via the analyser-api CLI (ast-grep based).
//!
//! The analyser runs on Node (native `@ast-grep/napi`), so it cannot run in
//! the webview. Mirrors the recli pattern: Rust spawns `node` against the
//! analyser CLI, dev resolves it from the workspace checkout, release from the
//! bundled Tauri resource (see `bundle.resources` in tauri.conf.json).

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::error::AppError;

/// Relative path of the analyser CLI entry inside the analyser-api workspace.
const CLI_REL: [&str; 4] = ["packages", "cli", "src", "index.ts"];

/// Hard cap for a single scan (large monorepos can take a while).
const SCAN_TIMEOUT: Duration = Duration::from_secs(180);

/// Locate the analyser CLI `index.ts` script.
///
/// Dev: the analyser-api workspace checkout lives at the repo root (sibling of
/// `src-tauri`). Release: analyser-api (source + prod node_modules) is bundled
/// as a Tauri resource under `analyser-api/`.
fn resolve_script_path(app: &AppHandle) -> Result<String, AppError> {
    let candidates: Vec<std::path::PathBuf> = if cfg!(debug_assertions) {
        let cwd = std::env::current_dir().map_err(|e| AppError::Internal(e.to_string()))?;
        vec![
            cwd.join("analyser-api").join(CLI_REL[0]).join(CLI_REL[1]).join(CLI_REL[2]).join(CLI_REL[3]),
            cwd.join("..").join("analyser-api").join(CLI_REL[0]).join(CLI_REL[1]).join(CLI_REL[2]).join(CLI_REL[3]),
        ]
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        vec![
            resource_dir
                .join("analyser-api")
                .join(CLI_REL[0])
                .join(CLI_REL[1])
                .join(CLI_REL[2])
                .join(CLI_REL[3]),
        ]
    };

    for p in &candidates {
        if p.exists() {
            return Ok(p.to_string_lossy().to_string());
        }
    }

    Err(AppError::NotFound(format!(
        "analyser-api CLI script not found (tried: {})",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )))
}

/// Scans a backend folder with analyser-api and returns the JSON analysis
/// (`--format json` output of `analyser scan`).
///
/// Async so a long scan does not block the IPC thread / freeze the UI; the
/// blocking process logic runs on a dedicated thread.
#[tauri::command]
pub async fn analyze_backend(app: AppHandle, folder: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || run_analysis(&app, &folder))
        .await
        .map_err(|e| AppError::Internal(format!("Analysis task failed: {}", e)))?
}

fn run_analysis(app: &AppHandle, folder: &str) -> Result<String, AppError> {
    let folder_path = std::path::Path::new(folder);
    if !folder_path.exists() {
        return Err(AppError::NotFound(format!("Folder not found: {}", folder)));
    }

    let script_path = resolve_script_path(&app)?;

    let node = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    // The analyser CLI relies on Node's type-stripping (>= 22.6).
    if Command::new(node)
        .args(["--experimental-strip-types", "--version"])
        .output()
        .is_err()
    {
        return Err(AppError::NotFound(format!(
            "Node.js 22.6+ not found (checked `{} --experimental-strip-types --version`). \
             Please install Node.js 22.6 or newer to analyse projects.",
            node
        )));
    }

    let mut cmd = Command::new(node);
    cmd.arg("--experimental-strip-types")
        .arg(&script_path)
        .arg("scan")
        .arg(&folder)
        .arg("--format")
        .arg("json")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("Failed to spawn analyser: {}", e)))?;

    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");
    let out_handle = std::thread::spawn(move || {
        let mut s = String::new();
        stdout.read_to_string(&mut s).ok();
        s
    });
    let err_handle = std::thread::spawn(move || {
        let mut s = String::new();
        stderr.read_to_string(&mut s).ok();
        s
    });

    let start = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if start.elapsed() >= SCAN_TIMEOUT => {
                child.kill().ok();
                break Err(AppError::Internal(format!(
                    "Analyser timed out after {}s",
                    SCAN_TIMEOUT.as_secs()
                )));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => {
                break Err(AppError::Internal(format!(
                    "Failed to inspect analyser process: {}",
                    e
                )))
            }
        }
    };

    let stdout = out_handle.join().unwrap_or_default();
    let stderr = err_handle.join().unwrap_or_default();

    match status {
        Ok(s) if s.success() => Ok(stdout),
        Ok(s) => Err(AppError::Internal(format!(
            "Analyser exited with code {}: {}",
            s.code().unwrap_or(-1),
            stderr.trim()
        ))),
        Err(e) => Err(e),
    }
}