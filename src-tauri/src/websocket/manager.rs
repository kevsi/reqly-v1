use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, mpsc};

use crate::error::AppError;

#[derive(Debug)]
pub enum WsCommand {
  Disconnect,
  SendMessage(String),
}

#[derive(Debug)]
pub struct ConnectionManager {
  inner: Arc<Mutex<HashMap<String, mpsc::SyncSender<WsCommand>>>>,
  connected: Arc<Mutex<HashSet<String>>>,
}

impl ConnectionManager {
  pub fn new() -> Self {
    Self {
      inner: Arc::new(Mutex::new(HashMap::new())),
      connected: Arc::new(Mutex::new(HashSet::new())),
    }
  }

  pub fn register(&self, id: String, sender: mpsc::SyncSender<WsCommand>) {
    self
      .inner
      .lock()
      .expect("connection manager lock poisoned in register")
      .insert(id, sender);
  }

  pub fn mark_connected(&self, id: &str) {
    self
      .connected
      .lock()
      .expect("connection manager lock poisoned in mark_connected")
      .insert(id.to_string());
  }

  pub fn unregister(&self, id: &str) -> bool {
    let removed = self
      .inner
      .lock()
      .expect("connection manager lock poisoned in unregister")
      .remove(id)
      .is_some();
    if removed {
      self
        .connected
        .lock()
        .expect("connection manager lock poisoned in unregister")
        .remove(id);
    }
    removed
  }

  pub fn send_message(&self, id: &str, message: String) -> Result<(), AppError> {
    let lock = self.inner.lock().map_err(AppError::from)?;
    let sender = lock.get(id).ok_or_else(|| AppError::NotFound(format!("connection not found: {}", id)))?;
    sender
      .try_send(WsCommand::SendMessage(message))
      .map_err(|_| AppError::Internal("send failed".to_string()))
  }

  pub fn has_connection(&self, id: &str) -> bool {
    self
      .inner
      .lock()
      .expect("connection manager lock poisoned in has_connection")
      .contains_key(id)
  }

  pub fn get_status(&self, id: &str) -> Option<super::types::WsStatus> {
    if !self.has_connection(id) {
      return None;
    }
    if self
      .connected
      .lock()
      .expect("connection manager lock poisoned in get_status")
      .contains(id)
    {
      Some(super::types::WsStatus::Connected)
    } else {
      Some(super::types::WsStatus::Connecting)
    }
  }
}
