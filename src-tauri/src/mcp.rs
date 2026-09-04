use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(feature = "ts-export")]
use ts_rs::TS;

use crate::error::AppError;

const MCP_BUNDLE_FILE: &str = "_mcp_bundle.json";
const MCP_DEFAULT_PORT: u16 = 3311;

#[derive(Default)]
pub struct McpProcessState {
    process: Option<Child>,
    port: Option<u16>,
    /// Shared secret required on every HTTP request to the sidecar. Generated
    /// per start, held in process memory only, surfaced to the renderer (which
    /// displays it to the user so their MCP client can present it). Without it,
    /// ANY local process — or any website via DNS-rebinding/CORS tricks —
    /// could drive the sidecar's tools (fail-open auth in recli).
    token: Option<String>,
}

pub type ManagedMcpState = Arc<Mutex<McpProcessState>>;

#[derive(Serialize, Deserialize, Clone)]
#[cfg_attr(feature = "ts-export", derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", ts(export, rename_all = "camelCase"))]
pub struct McpServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    /// Bearer token the MCP HTTP client must present. None when stopped.
    pub token: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[cfg_attr(feature = "ts-export", derive(TS))]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[cfg_attr(feature = "ts-export", ts(export, rename_all = "camelCase"))]
pub struct McpServerConfig {
    pub port: Option<u16>,
    pub env_name: Option<String>,
    pub allow_local_hosts: bool,
    pub max_response_size: Option<usize>,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            port: None,
            env_name: None,
            allow_local_hosts: false,
            max_response_size: None,
        }
    }
}

#[tauri::command]
pub fn start_mcp_server(
    app: AppHandle,
    bundle_json: String,
    config: Option<McpServerConfig>,
    mcp_state: tauri::State<'_, ManagedMcpState>,
) -> Result<String, AppError> {
    let mut state = mcp_state.lock()?;

    if let Some(ref mut process) = state.process {
        match process.try_wait() {
            Ok(None) => {
                return Err(AppError::AlreadyRunning(
                    "MCP server is already running".into(),
                ))
            }
            Ok(Some(_)) => {}
            Err(_) => {}
        }
    }

    let bundle_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {}", e)))?;
    std::fs::create_dir_all(&bundle_dir)?;
    let bundle_path = bundle_dir.join(MCP_BUNDLE_FILE);

    {
        let mut file = std::fs::File::create(&bundle_path)?;
        file.write_all(bundle_json.as_bytes())?;
    }

    let script_path = resolve_script_path(&app)?;
    let cfg = config.unwrap_or_default();
    let server_port = cfg.port.unwrap_or(MCP_DEFAULT_PORT);

    let node = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    // Ensure node is available before spawning
    if Command::new(node).arg("--version").output().is_err() {
        return Err(AppError::NotFound(format!(
            "Node.js runtime not found: {}. Please install Node.js to use the MCP server.",
            node
        )));
    }

    // SECURITY: the HTTP sidecar must never run without authentication.
    // Generate a per-run bearer token and require it on every request —
    // otherwise any local process (or a malicious website hitting
    // http://127.0.0.1:<port>/mcp from the victim's browser) can invoke the
    // sidecar's tools. The token is handed back to the renderer so the user
    // can configure their MCP client with it.
    let mcp_token = uuid::Uuid::new_v4().simple().to_string();

    let mut cmd = Command::new(node);
    cmd.arg(&script_path)
        .arg("serve")
        .arg("--file")
        .arg(&bundle_path)
        .arg("--port")
        .arg(server_port.to_string())
        .arg("--timeout")
        .arg("30000");

    if cfg.allow_local_hosts {
        log::warn!(
      "[mcp] allow_local_hosts is enabled — the MCP server can reach local/private networks. \
       Only enable this if you trust the MCP bundle. This flag bypasses the netguard SSRF protection."
    );
        cmd.arg("--allow-local-hosts");
    }

    if let Some(size) = cfg.max_response_size {
        cmd.arg("--max-response-size").arg(size.to_string());
    }

    if let Some(ref env_name) = cfg.env_name {
        // Validate env_name: must be a valid identifier (alphanumeric + underscore)
        if !env_name.is_empty() && !env_name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err(AppError::InvalidInput(
                "env_name must be a valid identifier (letters, digits, underscores only)".into(),
            ));
        }
        cmd.arg("--env").arg(env_name);
    }

    // The HTTP transport logs to stderr (never stdout), so we discard stdout and
    // pipe stderr so we can surface startup errors and avoid the child blocking
    // on a full pipe.
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdin(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("Failed to start MCP server: {}", e)))?;

    // SECURITY (audit 2026-09-04) : le token part par STDIN, pas en argv —
    // un token en ligne de commande est lisible par tout processus local via
    // la liste des process. Le sidecar recli le lit sur stdin (timeout 5 s).
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write as _;
        stdin
            .write_all(mcp_token.as_bytes())
            .map_err(|e| AppError::Internal(format!("Failed to send MCP token: {e}")))?;
        // stdin droppé sans EOF immédiat : le sidecar a déjà lu sa ligne et
        // continue de tourner ; le canal reste ouvert pour lui.
        drop(stdin);
    }

    // Drain stderr in a background thread so the long-lived child never blocks on a
    // full pipe, and so we can report the reason if startup fails.
    let mut stderr: Box<dyn Read + Send> = child
        .stderr
        .take()
        .map(|s| Box::new(s) as Box<dyn Read + Send>)
        .unwrap_or_else(|| {
            eprintln!("[mcp] stderr not available");
            Box::new(std::io::empty())
        });
    let captured = Arc::new(Mutex::new(String::new()));
    let captured_for_thread = Arc::clone(&captured);
    std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            match stderr.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Ok(text) = std::str::from_utf8(&buf[..n]) {
                        if let Ok(mut guard) = captured_for_thread.lock() {
                            guard.push_str(text);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Wait (bounded) for the process to settle. The server binds its port
    // asynchronously, so a quick exit here means startup failed (e.g. port in use).
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(1500);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let msg = captured.lock().ok().map(|g| g.clone()).unwrap_or_default();
                return Err(AppError::Internal(format!(
                    "MCP server exited during startup. {}",
                    msg.trim()
                )));
            }
            Ok(None) if start.elapsed() >= timeout => break,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(e) => {
                return Err(AppError::Internal(format!(
                    "Failed to inspect MCP process: {}",
                    e
                )))
            }
        }
    }

    let pid = child.id();
    state.process = Some(child);
    state.port = Some(server_port);
    state.token = Some(mcp_token.clone());

    let _ = app.emit(
        "mcp-status",
        McpServerStatus {
            running: true,
            port: Some(server_port),
            pid: Some(pid),
            token: Some(mcp_token),
        },
    );

    Ok(format!(
        "MCP server started on port {} (PID: {})",
        server_port, pid
    ))
}

#[tauri::command]
pub fn stop_mcp_server(
    app: AppHandle,
    mcp_state: tauri::State<'_, ManagedMcpState>,
) -> Result<String, AppError> {
    let mut state = mcp_state.lock()?;

    match state.process.take() {
        Some(mut child) => {
            let _ = child.kill();

            // Wait for the process with a timeout to avoid hanging if the child ignores SIGTERM.
            let start = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) if start.elapsed().as_secs() < 5 => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    _ => {
                        let _ = child.kill();
                        break;
                    }
                }
            }

            state.port = None;
            state.token = None;

            let _ = app.emit(
                "mcp-status",
                McpServerStatus {
                    running: false,
                    port: None,
                    pid: None,
                    token: None,
                },
            );

            Ok("MCP server stopped".to_string())
        }
        None => Err(AppError::NotRunning("MCP server is not running".into())),
    }
}

#[tauri::command]
pub fn get_mcp_server_status(
    mcp_state: tauri::State<'_, ManagedMcpState>,
) -> Result<McpServerStatus, AppError> {
    let mut state = mcp_state.lock()?;

    let (running, pid) = match state.process.as_mut() {
        Some(process) => match process.try_wait() {
            Ok(None) => (true, Some(process.id())),
            _ => {
                // Process exited, clean up
                state.port = None;
                state.token = None;
                (false, None)
            }
        },
        None => (false, None),
    };

    Ok(McpServerStatus {
        running,
        port: state.port,
        pid,
        token: if running { state.token.clone() } else { None },
    })
}

/// Returns the path to the MCP bundle file.
fn mcp_bundle_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let bundle_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {}", e)))?;
    Ok(bundle_dir.join(MCP_BUNDLE_FILE))
}

/// Read the MCP bundle file and return its JSON content.
#[tauri::command]
pub fn read_mcp_bundle(app: AppHandle) -> Result<String, AppError> {
    let bundle_path = mcp_bundle_path(&app)?;
    if !bundle_path.exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(&bundle_path)?)
}

/// Read collections from the MCP bundle and emit them to the frontend.
/// The frontend should listen for "mcp-sync-collections" events.
#[tauri::command]
pub fn sync_mcp_collections(app: AppHandle) -> Result<(), AppError> {
    let bundle_path = mcp_bundle_path(&app)?;
    if !bundle_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&bundle_path)?;
    let parsed: serde_json::Value = serde_json::from_str(&content)?;
    let _ = app.emit("mcp-sync-collections", &parsed);

    Ok(())
}

/// Locate the recli `dist/index.js` script (the MCP server runs via `recli serve`).
fn resolve_script_path(app: &AppHandle) -> Result<String, AppError> {
    let candidates: Vec<std::path::PathBuf> = if cfg!(debug_assertions) {
        // Dev: the workspace checkout lives either at `cwd` (project root) or one
        // level up (when launched from inside `src-tauri`).
        let cwd = std::env::current_dir().map_err(|e| AppError::Internal(e.to_string()))?;
        vec![
            cwd.join("recli").join("dist").join("index.js"),
            cwd.join("..").join("recli").join("dist").join("index.js"),
        ]
    } else {
        // Release: recli (dist + prod node_modules) is bundled as a Tauri resource
        // (see `bundle.resources` in tauri.conf.json) so `node recli serve` works
        // without a global install.
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        vec![resource_dir.join("recli").join("dist").join("index.js")]
    };

    for p in &candidates {
        if p.exists() {
            return Ok(p.to_string_lossy().to_string());
        }
    }

    Err(AppError::NotFound(format!(
        "recli script not found (tried: {})",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_server_status_default_running_false() {
        let status = McpServerStatus {
            token: None,
            running: false,
            port: None,
            pid: None,
        };
        assert!(!status.running);
        assert!(status.port.is_none());
        assert!(status.pid.is_none());
    }

    #[test]
    fn test_mcp_server_status_serialization() {
        let status = McpServerStatus {
            token: None,
            running: true,
            port: Some(3311),
            pid: Some(12345),
        };
        let json = serde_json::to_string(&status).expect("serialize");
        assert!(json.contains("\"running\":true"));
        assert!(json.contains("\"port\":3311"));
        assert!(json.contains("\"pid\":12345"));
        // Verify camelCase
        assert!(json.contains("\"running\""));
    }

    #[test]
    fn test_mcp_server_config_defaults() {
        let config = McpServerConfig::default();
        assert!(config.port.is_none());
        assert!(config.env_name.is_none());
        assert!(!config.allow_local_hosts);
        assert!(config.max_response_size.is_none());
    }

    #[test]
    fn test_mcp_process_state_default_not_running() {
        let state = McpProcessState::default();
        assert!(state.process.is_none());
        assert!(state.port.is_none());
    }

    #[test]
    fn test_mcp_server_config_custom_values() {
        let config = McpServerConfig {
            port: Some(8080),
            env_name: Some("production".into()),
            allow_local_hosts: true,
            max_response_size: Some(5_242_880),
        };
        assert_eq!(config.port, Some(8080));
        assert_eq!(config.env_name, Some("production".into()));
        assert!(config.allow_local_hosts);
        assert_eq!(config.max_response_size, Some(5_242_880));
    }

    #[test]
    fn test_mcp_server_status_deserialization() {
        let json = r#"{"running":true,"port":3311,"pid":12345}"#;
        let status: McpServerStatus = serde_json::from_str(json).expect("deserialize");
        assert!(status.running);
        assert_eq!(status.port, Some(3311));
        assert_eq!(status.pid, Some(12345));
    }

    #[test]
    fn test_mcp_server_status_roundtrip() {
        let original = McpServerStatus {
            token: None,
            running: true,
            port: Some(3311),
            pid: Some(12345),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: McpServerStatus = serde_json::from_str(&json).expect("deserialize");
        assert!(deserialized.running);
        assert_eq!(deserialized.port, Some(3311));
        assert_eq!(deserialized.pid, Some(12345));
    }

    #[test]
    fn test_mcp_server_config_partial_json_defaults() {
        // Only port is provided; serde(default) should fill in the rest.
        let json = r#"{"port":9000}"#;
        let config: McpServerConfig = serde_json::from_str(json).expect("deserialize partial");
        assert_eq!(config.port, Some(9000));
        assert!(config.env_name.is_none());
        assert!(!config.allow_local_hosts);
        assert!(config.max_response_size.is_none());
    }

    #[test]
    fn test_mcp_server_config_empty_json_defaults() {
        // Empty object; all fields should come from Default.
        let json = r#"{}"#;
        let config: McpServerConfig = serde_json::from_str(json).expect("deserialize empty");
        assert!(config.port.is_none());
        assert!(config.env_name.is_none());
        assert!(!config.allow_local_hosts);
        assert!(config.max_response_size.is_none());
    }

    #[test]
    fn test_mcp_server_config_full_json() {
        // Round-trip a fully populated JSON payload.
        let json =
            r#"{"port":4000,"envName":"staging","allowLocalHosts":true,"maxResponseSize":1048576}"#;
        let config: McpServerConfig = serde_json::from_str(json).expect("deserialize full");
        assert_eq!(config.port, Some(4000));
        assert_eq!(config.env_name, Some("staging".into()));
        assert!(config.allow_local_hosts);
        assert_eq!(config.max_response_size, Some(1_048_576));
        // Verify round-trip
        let output = serde_json::to_string(&config).expect("serialize");
        assert!(output.contains("\"port\":4000"));
        assert!(output.contains("\"envName\""));
        assert!(output.contains("\"allowLocalHosts\":true"));
    }

    #[test]
    fn test_mcp_server_port_range_safety() {
        // u16 already enforces 0–65535 at the type level; this test
        // confirms that valid edge values survive serialization.
        let min = McpServerConfig {
            port: Some(0),
            ..McpServerConfig::default()
        };
        let max = McpServerConfig {
            port: Some(65535),
            ..McpServerConfig::default()
        };
        let min_str = serde_json::to_string(&min).expect("serialize");
        let max_str = serde_json::to_string(&max).expect("serialize");
        assert!(min_str.contains("\"port\":0"));
        assert!(max_str.contains("\"port\":65535"));
    }

    #[test]
    fn test_mcp_server_config_env_name_edge_cases() {
        // Empty string env name is valid (not None).
        let config = McpServerConfig {
            env_name: Some(String::new()),
            ..McpServerConfig::default()
        };
        assert_eq!(config.env_name, Some(String::new()));
        // Verify round-trip
        let json = serde_json::to_string(&config).expect("serialize");
        assert!(json.contains("\"envName\":\"\""));
    }
}
