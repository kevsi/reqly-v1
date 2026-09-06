use std::sync::{Arc, Mutex};

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

mod analyzer;
pub mod capture;
pub mod capture_https;
mod error;
mod fetch;
pub mod git;
mod mcp;
mod oauth;
mod open;
mod store;
mod websocket;
#[cfg(feature = "ts-export")]
mod ts_bindings;

use crate::capture::{
    clear_captured_sessions, delete_captured_session, get_captured_session, list_captured_sessions,
    set_bandwidth_limit, start_capture_proxy, stop_capture_proxy, ManagedCaptureProxyState,
};
use crate::capture_https::ManagedHttpsProxyState;
use crate::fetch::{fetch_proxy, SharedClient};
use crate::open::{export_files, export_json, open_external, save_file};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install Rustls crypto provider before any TLS operation.
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install Rustls crypto provider");

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // Le plugin deep-link gère la redirection avec single-instance
        }));
    }

    // Timeout: 65s for both clients so the Rust layer outlives the frontend's
    // 60s AbortController timeout (proxy-ai/route.ts).  If the Rust client times
    // out first the user sees a reqwest error instead of their intended abort.
    const CLIENT_TIMEOUT_SECS: u64 = 65;

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CLIENT_TIMEOUT_SECS))
        .cookie_store(true)
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .build()
        .expect("failed to create HTTP client");

    // Variante sans redirection : le toggle followRedirects de l'UI doit être
    // respecté (les 3xx sont alors retournés tels quels au frontend).
    let http_client_no_redirect = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CLIENT_TIMEOUT_SECS))
        .cookie_store(true)
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("failed to create no-redirect HTTP client");

    #[cfg(debug_assertions)]
    let insecure_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CLIENT_TIMEOUT_SECS))
        .cookie_store(true)
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .danger_accept_invalid_certs(true)
        .build()
        .expect("failed to create insecure HTTP client");

    #[cfg(debug_assertions)]
    let insecure_client_no_redirect = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CLIENT_TIMEOUT_SECS))
        .cookie_store(true)
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("failed to create insecure no-redirect HTTP client");

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(SharedClient {
            normal: http_client,
            normal_no_redirect: http_client_no_redirect,
            #[cfg(debug_assertions)]
            insecure: insecure_client,
            #[cfg(debug_assertions)]
            insecure_no_redirect: insecure_client_no_redirect,
        })
        .manage::<ManagedCaptureProxyState>(Arc::new(Mutex::new(
            capture::CaptureProxyState::default(),
        )))
        .manage::<ManagedHttpsProxyState>(Arc::new(Mutex::new(None)))
        .manage::<mcp::ManagedMcpState>(Arc::new(Mutex::new(mcp::McpProcessState::default())))
        .manage::<git::commands::GitRepoState>(git::commands::GitRepoState::new())
        .manage::<websocket::WsConnections>(websocket::WsConnections::default())
        .invoke_handler(tauri::generate_handler![
            fetch_proxy,
            export_json,
            export_files,
            open_external,
            analyzer::analyze_backend,
            start_capture_proxy,
            stop_capture_proxy,
            list_captured_sessions,
            get_captured_session,
            delete_captured_session,
            clear_captured_sessions,
            set_bandwidth_limit,
            capture_https::get_capture_ca_info,
            capture_https::start_capture_https_proxy,
            capture_https::stop_capture_https_proxy,
            git::commands::git_init,
            git::commands::git_open,
            git::commands::git_status,
            git::commands::git_log,
            git::commands::git_commit,
            git::commands::git_stage,
            git::commands::git_stage_all,
            git::commands::git_unstage,
            git::commands::git_diff,
            git::commands::git_branch_list,
            git::commands::git_branch_create,
            git::commands::git_branch_delete,
            git::commands::git_branch_switch,
            git::commands::git_remote_list,
            git::commands::git_remote_add,
            git::commands::git_remote_remove,
            git::commands::git_push,
            git::commands::git_push_force,
            git::commands::git_fetch,
            git::commands::git_pull,
            git::commands::git_clone,
            git::commands::git_write_collection_file,
            git::commands::git_ls_remote,
            git::commands::git_stash_save,
            git::commands::git_stash_pop,
            git::commands::git_stash_apply,
            git::commands::git_stash_drop,
            git::commands::git_stash_list,
            mcp::start_mcp_server,
            mcp::stop_mcp_server,
            mcp::get_mcp_server_status,
            mcp::read_mcp_bundle,
            mcp::sync_mcp_collections,
            save_file,
            store::enqueue_request,
            store::list_pending,
            store::dequeue_ready,
            store::mark_sent,
            store::get_encryption_passphrase,
            oauth::start_device_flow_cmd,
            oauth::poll_device_token_cmd,
            oauth::start_github_oauth_server,
            websocket::ws_connect,
            websocket::ws_send,
            websocket::ws_close,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Enregistrer le schéma de deep-link pour que le navigateur externe puisse rediriger vers reqly://
            app.deep_link().register("reqly").ok();

            // Point the offline queue store at the app's data directory (falls back
            // to a temp dir if it cannot be resolved).
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                crate::store::init_queue_store(app_data_dir.clone());
                crate::capture::init_capture_store(app_data_dir.clone());
                app.state::<git::commands::GitRepoState>()
                    .set_workspace_dir(app_data_dir)
                    .ok();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
