use reqly_lib::websocket::commands::{
    ws_disconnect_manager,
    ws_get_status_manager,
    ws_send_manager,
};
use reqly_lib::websocket::manager::{ConnectionManager, WsCommand};
use reqly_lib::websocket::types::WsStatus;

fn setup_manager() -> ConnectionManager {
    ConnectionManager::new()
}

// ─── error paths for unknown connections ───────────────────────────────────

#[test]
fn ws_send_returns_not_found_for_unknown_connection() {
    let manager = setup_manager();

    let result = ws_send_manager("missing".into(), "hello".into(), &manager);

    assert!(result.is_err());
}

#[test]
fn ws_disconnect_returns_not_found_for_unknown_connection() {
    let manager = setup_manager();

    let result = ws_disconnect_manager("missing".into(), &manager);

    assert!(result.is_err());
}

#[test]
fn ws_get_status_returns_not_found_for_unknown_connection() {
    let manager = setup_manager();

    let result = ws_get_status_manager("missing".into(), &manager);

    assert!(result.is_err());
}

// ─── happy paths via pre-registered connections ────────────────────────────

#[test]
fn ws_get_status_reports_connecting_after_register() {
    let manager = setup_manager();
    let (tx, _rx) = std::sync::mpsc::sync_channel::<WsCommand>(1);
    manager.register("conn-1".into(), tx);

    let result = ws_get_status_manager("conn-1".into(), &manager);

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), WsStatus::Connecting);
}

#[test]
fn ws_disconnect_unregisters_connection() {
    let manager = setup_manager();
    let (tx, _rx) = std::sync::mpsc::sync_channel::<WsCommand>(1);
    manager.register("conn-1".into(), tx);

    ws_disconnect_manager("conn-1".into(), &manager)
        .expect("disconnect should succeed");

    let status = manager.get_status("conn-1");
    assert!(status.is_none());
}
