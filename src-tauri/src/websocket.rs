//! Client WebSocket desktop — connexions sortantes pilotées par l'UI.
//!
//! Contrairement à l'API `WebSocket` du webview, ce module accepte des
//! en-têtes personnalisés (Authorization, X-API-Key…) indispensables à un
//! client d'API. Chaque connexion vit dans une paire de tâches tokio : la
//! boucle de lecture émet des événements Tauri (`ws-message` / `ws-status`),
//! les envois passent par un canal mpsc vers la tâche d'écriture.
//!
//! Architecture testable : `run_ws_session` ne connaît pas Tauri — elle
//! pousse ses événements dans un canal ; la commande connect elle-même se
//! contente de relayer ce canal vers `app.emit`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tokio::net::TcpStream;

use crate::error::AppError;

/// Cap des messages entrants (8 Mo) : au-delà, la connexion est rompue par
/// tungstenite plutôt que d'accumuler la mémoire côté desktop.
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// Capacité du canal d'envoi ; un producteur rapide ne peut pas bloquer l'UI.
const OUTBOUND_CAPACITY: usize = 64;

type WsSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Événements produits par une session WebSocket, indépendants de Tauri.
#[derive(Debug, Clone)]
pub(crate) enum WsEvent {
    Message(WsMessageEvent),
    Status(WsStatusEvent),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsMessageEvent {
    pub connection_id: String,
    /// text | binary | ping | pong
    pub kind: String,
    /// Texte du message (UTF-8) ou base64 pour les binaires et les pings.
    pub data: String,
    pub byte_len: usize,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsStatusEvent {
    pub connection_id: String,
    /// open | closed | error
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsConnectResult {
    pub connection_id: String,
}

pub(crate) enum Outbound {
    Message(Message),
    Close(Option<(u16, String)>),
}

struct WsHandle {
    outbound: mpsc::Sender<Outbound>,
}

/// Connexions WebSocket vivantes, indexées par identifiant unique.
#[derive(Default)]
pub struct WsConnections(Mutex<HashMap<String, WsHandle>>);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Valide l'URL cible : ws:// ou wss:// uniquement, avec un hôte présent.
/// file://, http(s):// et tout autre schéma sont refusés.
pub fn validate_ws_url(raw: &str) -> Result<String, AppError> {
    let parsed = reqwest::Url::parse(raw.trim())
        .map_err(|e| AppError::InvalidInput(format!("URL WebSocket invalide : {}", e)))?;
    let scheme = parsed.scheme();
    if scheme != "ws" && scheme != "wss" {
        return Err(AppError::InvalidInput(format!(
            "Schéma refusé : {}. Seuls ws:// et wss:// sont autorisés.",
            scheme
        )));
    }
    if parsed.host_str().is_none() {
        return Err(AppError::InvalidInput(
            "URL WebSocket sans hôte".to_string(),
        ));
    }
    Ok(parsed.to_string())
}

fn message_event(connection_id: &str, kind: &str, data: String, byte_len: usize) -> WsEvent {
    WsEvent::Message(WsMessageEvent {
        connection_id: connection_id.to_string(),
        kind: kind.to_string(),
        data,
        byte_len,
        timestamp: now_ms(),
    })
}

fn status_event(connection_id: &str, status: &str, reason: Option<String>) -> WsEvent {
    WsEvent::Status(WsStatusEvent {
        connection_id: connection_id.to_string(),
        status: status.to_string(),
        reason,
    })
}

/// Boucle complète d'une session : écriture concurrente + lecture jusqu'à
/// fermeture. Générique sur le flux sous-jacent pour être testable avec un
/// serveur en clair (MaybeTlsStream::Plain côté production).
pub(crate) async fn run_ws_session<S>(
    socket: WebSocketStream<S>,
    connection_id: String,
    mut outbound_rx: mpsc::Receiver<Outbound>,
    // Clone du producteur d'envoi conservé par la session : les pongs
    // générés automatiquement transitent par le même canal que l'UI.
    outbound_tx: mpsc::Sender<Outbound>,
    events: mpsc::UnboundedSender<WsEvent>,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut sink, mut stream) = socket.split();
    let connection_id_ref = connection_id.clone();

    // Mémorisée par la tâche d'écriture : si le serveur coupe TCP sans
    // répondre au close handshake, la lecture doit produire « closed »
    // (déconnexion voulue) et non « error ».
    let close_request: Arc<std::sync::Mutex<Option<(u16, String)>>> =
        Arc::new(std::sync::Mutex::new(None));
    let close_request_writer = Arc::clone(&close_request);

    let writer = tokio::spawn(async move {
        while let Some(action) = outbound_rx.recv().await {
            let result = match action {
                Outbound::Message(msg) => sink.send(msg).await,
                Outbound::Close(frame) => {
                    let close = frame.as_ref().map(|(code, reason)| CloseFrame {
                        code: (*code).into(),
                        reason: reason.clone().into(),
                    });
                    *close_request_writer.lock().unwrap() = frame;
                    let _ = sink.send(Message::Close(close)).await;
                    let _ = sink.flush().await;
                    break;
                }
            };
            if let Err(err) = result {
                log::warn!("WebSocket write error ({}): {}", connection_id_ref, err);
                break;
            }
        }
    });

    let _ = events.send(status_event(&connection_id, "open", None));

    let mut terminal: Option<WsEvent> = None;

    while let Some(item) = stream.next().await {
        match item {
            Ok(Message::Text(text)) => {
                let len = text.len();
                let _ = events.send(message_event(
                    &connection_id,
                    "text",
                    text.to_string(),
                    len,
                ));
            }
            Ok(Message::Binary(bytes)) => {
                let len = bytes.len();
                let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                let _ = events.send(message_event(
                    &connection_id,
                    "binary",
                    encoded,
                    len,
                ));
            }
            Ok(Message::Ping(payload)) => {
                // tungstenite scinde lecture/écriture : le pong doit passer
                // explicitement par le canal d'envoi, sinon il ne part jamais.
                let len = payload.len();
                let encoded = base64::engine::general_purpose::STANDARD.encode(&payload);
                let _ = outbound_tx.send(Outbound::Message(Message::Pong(payload))).await;
                let _ = events.send(message_event(
                    &connection_id,
                    "ping",
                    encoded,
                    len,
                ));
            }
            Ok(Message::Pong(_)) => {}
            Ok(Message::Close(frame)) => {
                let reason = frame.map(|f| f.reason.to_string());
                terminal = Some(status_event(&connection_id, "closed", reason));
                break;
            }
            Ok(Message::Frame(_)) => {}
            Err(err) => {
                let requested = close_request.lock().unwrap().clone();
                terminal = if requested.is_some() {
                    Some(status_event(&connection_id, "closed", None))
                } else {
                    Some(status_event(
                        &connection_id,
                        "error",
                        Some(err.to_string()),
                    ))
                };
                break;
            }
        }
    }

    // Terminaison : demander une fermeture côté écriture (sans code — 1005
    // ne doit jamais circuler sur le fil). Le handle est retiré par la
    // commande appelante ; les ws_send suivants échoueront proprement.
    let _ = outbound_tx.send(Outbound::Close(None)).await;
    drop(outbound_tx);
    let _ = writer.await;

    let final_event = terminal
        .unwrap_or_else(|| status_event(&connection_id, "closed", None));
    let _ = events.send(final_event);
}

async fn connect_socket(
    url: &str,
    headers: &[(String, String)],
    subprotocols: &[String],
) -> Result<WsSocket, AppError> {
    let mut request = url
        .into_client_request()
        .map_err(|e| AppError::InvalidInput(format!("Requête WebSocket invalide : {}", e)))?;

    for (name, value) in headers {
        let parsed = value
            .parse()
            .map_err(|_| AppError::InvalidInput(format!("Valeur d'en-tête invalide : {}", value)))?;
        request
            .headers_mut()
            .insert(<&str as TryInto<http::HeaderName>>::try_into(name.as_str()).map_err(|_| {
                AppError::InvalidInput(format!("Nom d'en-tête invalide : {}", name))
            })?, parsed);
    }

    if !subprotocols.is_empty() {
        let joined = subprotocols.join(", ");
        let value = joined.parse().map_err(|_| {
            AppError::InvalidInput(format!("Sous-protocole invalide : {}", joined))
        })?;
        request.headers_mut().insert("Sec-WebSocket-Protocol", value);
    }

    let config = WebSocketConfig {
        max_message_size: Some(MAX_MESSAGE_BYTES),
        max_frame_size: Some(MAX_FRAME_BYTES),
        ..Default::default()
    };

    let (socket, _response) = tokio_tungstenite::connect_async_with_config(request, Some(config), false)
        .await
        .map_err(|e| AppError::Network {
            kind: crate::error::NetworkErrorKind::Unknown,
            message: "La connexion WebSocket a échoué.".to_string(),
            detail: e.to_string(),
        })?;

    Ok(socket)
}

#[tauri::command]
pub async fn ws_connect(
    url: String,
    headers: Option<Vec<(String, String)>>,
    subprotocols: Option<Vec<String>>,
    app: AppHandle,
    state: State<'_, WsConnections>,
) -> Result<WsConnectResult, AppError> {
    let normalized = validate_ws_url(&url)?;
    let headers = headers.unwrap_or_default();
    let subprotocols = subprotocols.unwrap_or_default();

    let socket = connect_socket(&normalized, &headers, &subprotocols).await?;

    let connection_id = uuid::Uuid::new_v4().to_string();
    let (outbound_tx, outbound_rx) = mpsc::channel::<Outbound>(OUTBOUND_CAPACITY);
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<WsEvent>();

    state
        .0
        .lock()
        .unwrap()
        .insert(connection_id.clone(), WsHandle {
            outbound: outbound_tx.clone(),
        });

    // Relais des événements de session vers le bus Tauri.
    let relay_app = app.clone();
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            match event {
                WsEvent::Message(message) => {
                    let _ = relay_app.emit("ws-message", &message);
                }
                WsEvent::Status(status) => {
                    let _ = relay_app.emit("ws-status", &status);
                }
            }
        }
    });

    let session_id = connection_id.clone();
    tokio::spawn(async move {
        // Retrait du handle à la fin de la session : le lookup courant est
        // un no-op si ws_close l'a déjà retiré.
        let app_for_cleanup = app.clone();
        run_ws_session(socket, session_id.clone(), outbound_rx, outbound_tx, event_tx).await;
        app_for_cleanup
            .state::<WsConnections>()
            .0
            .lock()
            .unwrap()
            .remove(&session_id);
    });

    Ok(WsConnectResult { connection_id })
}

#[tauri::command]
pub async fn ws_send(
    connection_id: String,
    data: String,
    binary: Option<bool>,
    state: State<'_, WsConnections>,
) -> Result<(), AppError> {
    let message = if binary.unwrap_or(false) {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|e| AppError::InvalidInput(format!("Payload binaire invalide (base64) : {}", e)))?;
        if bytes.len() > MAX_MESSAGE_BYTES {
            return Err(AppError::InvalidInput(format!(
                "Message trop volumineux : {} octets (max {})",
                bytes.len(),
                MAX_MESSAGE_BYTES
            )));
        }
        Message::Binary(bytes)
    } else {
        if data.len() > MAX_MESSAGE_BYTES {
            return Err(AppError::InvalidInput(format!(
                "Message trop volumineux : {} octets (max {})",
                data.len(),
                MAX_MESSAGE_BYTES
            )));
        }
        Message::Text(data)
    };

    let sender = {
        let map = state.0.lock().unwrap();
        map.get(&connection_id)
            .map(|handle| handle.outbound.clone())
            .ok_or_else(|| {
                AppError::InvalidInput("Connexion WebSocket inconnue ou fermée".to_string())
            })?
    };

    sender
        .send(Outbound::Message(message))
        .await
        .map_err(|_| AppError::InvalidInput("Connexion WebSocket en cours de fermeture".to_string()))
}

#[tauri::command]
pub async fn ws_close(
    connection_id: String,
    code: Option<u16>,
    reason: Option<String>,
    state: State<'_, WsConnections>,
) -> Result<(), AppError> {
    let handle = state
        .0
        .lock()
        .unwrap()
        .remove(&connection_id)
        .ok_or_else(|| {
            AppError::InvalidInput("Connexion WebSocket inconnue ou déjà fermée".to_string())
        })?;

    // La lecture se poursuit jusqu'au close frame du serveur : les derniers
    // messages entrants sont toujours livrés avant l'événement terminal.
    let _ = handle
        .outbound
        .send(Outbound::Close(code.map(|c| (c, reason.unwrap_or_default()))))
        .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::accept_async;

    fn drain_status(events: &mut mpsc::UnboundedReceiver<WsEvent>) -> Vec<(String, Option<String>)> {
        let mut statuses = Vec::new();
        while let Ok(event) = events.try_recv() {
            if let WsEvent::Status(status) = event {
                statuses.push((status.status, status.reason));
            }
        }
        statuses
    }

    #[test]
    fn validates_ws_urls() {
        assert!(validate_ws_url("ws://localhost:9000/socket").is_ok());
        assert!(validate_ws_url("wss://example.com/socket").is_ok());
        assert!(validate_ws_url("https://example.com/socket").is_err());
        assert!(validate_ws_url("file:///etc/passwd").is_err());
        assert!(validate_ws_url("javascript:alert(1)").is_err());
        assert!(validate_ws_url("not a url").is_err());
    }

    #[tokio::test]
    async fn session_streams_messages_and_closes_cleanly() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            socket.send(Message::Text("hello from server".into())).await.unwrap();
            // Lire une requête du client puis fermer proprement.
            while let Some(Ok(msg)) = socket.next().await {
                match msg {
                    Message::Text(t) if t == "ping-me" => {
                        socket.send(Message::Text("pong".into())).await.unwrap();
                    }
                    Message::Close(_) => {
                        // Répondre au close handshake avant de couper.
                        let _ = socket.send(Message::Close(None)).await;
                        let _ = socket.flush().await;
                        break;
                    }
                    _ => {}
                }
            }
        });

        let socket = connect_socket(
            &format!("ws://{}", addr),
            &[("X-Test-Header".to_string(), "reqly".to_string())],
            &[],
        )
        .await
        .unwrap();

        let (outbound_tx, outbound_rx) = mpsc::channel(8);
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();

        let session = tokio::spawn(run_ws_session(
            socket,
            "test-conn".to_string(),
            outbound_rx,
            outbound_tx.clone(),
            event_tx,
        ));

        // Attendre l'événement open puis le message serveur.
        let mut saw_open = false;
        let mut first_message = None;
        for _ in 0..2 {
            let event = event_rx.recv().await.unwrap();
            match event {
                WsEvent::Status(s) if s.status == "open" => saw_open = true,
                WsEvent::Message(m) if m.kind == "text" => first_message = Some(m.data),
                _ => {}
            }
        }
        assert!(saw_open);
        assert_eq!(first_message.as_deref(), Some("hello from server"));

        outbound_tx
            .send(Outbound::Message(Message::Text("ping-me".into())))
            .await
            .unwrap();
        let mut got_reply = false;
        for _ in 0..4 {
            match event_rx.recv().await.unwrap() {
                WsEvent::Message(m) if m.kind == "text" && m.data == "pong" => {
                    got_reply = true;
                    break;
                }
                _ => {}
            }
        }
        assert!(got_reply);

        // Fermeture par le client.
        outbound_tx
            .send(Outbound::Close(Some((1000, "done".to_string()))))
            .await
            .unwrap();
        let _ = session.await;

        let statuses = drain_status(&mut event_rx)
            .into_iter()
            .filter(|(s, _)| s != "open")
            .collect::<Vec<_>>();
        assert!(
            statuses.iter().any(|(s, _)| s == "closed"),
            "expected clean close event, got {:?}",
            statuses
        );
        server.await.unwrap();
    }
}
