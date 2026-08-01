use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WsStatus {
  Connecting,
  Connected,
  Disconnected,
}
