use crate::error::AppError;
use crate::websocket::manager::ConnectionManager;
use crate::websocket::types::WsStatus;
use tauri::State;

pub fn ws_send_manager(
  id: String,
  message: String,
  manager: &ConnectionManager,
) -> Result<(), AppError> {
  manager.send_message(&id, message)
}

#[tauri::command]
pub fn ws_send(
  id: String,
  message: String,
  manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
  ws_send_manager(id, message, &manager)
}

pub fn ws_disconnect_manager(
  id: String,
  manager: &ConnectionManager,
) -> Result<(), AppError> {
  if manager.unregister(&id) {
    Ok(())
  } else {
    Err(AppError::NotFound(format!("connection not found: {}", id)))
  }
}

#[tauri::command]
pub fn ws_disconnect(
  id: String,
  manager: State<'_, ConnectionManager>,
) -> Result<(), AppError> {
  ws_disconnect_manager(id, &manager)
}

pub fn ws_get_status_manager(
  id: String,
  manager: &ConnectionManager,
) -> Result<WsStatus, AppError> {
  manager
    .get_status(&id)
    .ok_or_else(|| AppError::NotFound(format!("connection not found: {}", id)))
}

#[tauri::command]
pub fn ws_get_status(
  id: String,
  manager: State<'_, ConnectionManager>,
) -> Result<WsStatus, AppError> {
  ws_get_status_manager(id, &manager)
}
