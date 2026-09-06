//! Interception HTTPS (MITM) du proxy de capture.
//!
//! Complète `capture.rs` (HTTP pur, tiny_http) avec un listener tokio qui
//! gère les tunnels `CONNECT` des navigateurs/clients configurés en proxy :
//!
//! 1. Le client envoie `CONNECT host:port` → on répond
//!    `200 Connection established`.
//! 2. On lui présente un certificat feuille généré À LA VOLÉE pour `host`,
//!    signé par la CA locale de Reqly (persistée dans le dossier de données
//!    de l'app — l'utilisateur l'installe une fois dans son trust store).
//! 3. On lit les requêtes HTTP/1.1 intérieures (httparse), on les émet à
//!    l'UI (`captured-request` / `captured-request-updated`), puis on les
//!    transmet au serveur réel via le client reqwest existant.
//!
//! Garde-fous : mêmes redactions/caps que la capture HTTP (headers
//! sensibles masqués, corps plafonnés), CA jamais exposée hors du disque
//! local, refus des cibles métadonnées cloud (réutilise capture.rs).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rcgen::{Certificate, CertificateParams, DnType, KeyPair};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tauri::{AppHandle, Emitter};

use crate::capture::{
    block_metadata_targets, redact_headers, write_captures, CapturedRequest,
    ManagedCaptureProxyState, MAX_CAPTURED_SESSIONS,
};
use crate::error::{AppError, NetworkErrorKind};

/// Émission des événements de capture, découplée de Tauri pour être
/// testable hors application (émetteur silencieux dans les tests).
pub enum CaptureEmitter {
    Tauri(AppHandle),
    Silent,
}

impl CaptureEmitter {
    fn captured(&self, req: &CapturedRequest) {
        if let CaptureEmitter::Tauri(app) = self {
            let _ = app.emit("captured-request", req);
        }
    }
    fn captured_updated(&self, req: &CapturedRequest) {
        if let CaptureEmitter::Tauri(app) = self {
            let _ = app.emit("captured-request-updated", req);
        }
    }
}

/// Cap du corps de requête intercepté (10 Mo, aligné sur capture.rs).
const MAX_REQUEST_BODY: usize = 10 * 1024 * 1024;
/// Cap du corps de réponse renvoyé au client (50 Mo, aligné sur capture.rs).
const MAX_RESPONSE_BODY: usize = 50 * 1024 * 1024;
/// Garde-fou mémoire de la boucle d'entêtes intérieurs.
const MAX_HEAD_BUFFER: usize = 256 * 1024;
const HEADER_TIMEOUT: Duration = Duration::from_secs(15);
const BODY_TIMEOUT: Duration = Duration::from_secs(60);

// ── CA locale + certificats feuilles ────────────────────────────────────────

/// Params de la CA — une seule source de vérité (génération ET rechargement
/// depuis le disque reconstruisent le même certificat).
fn build_ca_params() -> CertificateParams {
    let mut params = CertificateParams::default();
    params.distinguished_name.push(DnType::CommonName, "Reqly Capture CA");
    params.distinguished_name.push(DnType::OrganizationName, "Reqly");
    // 10 ans : une installation utilisateur doit durer.
    params.not_after = rcgen::date_time_ymd(2036, 1, 1);
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params
}

pub struct LocalCa {
    /// PEM du certificat CA (à installer dans le trust store de l'OS).
    pub cert_pem: String,
    /// Objet rcgen conservé pour signer les feuilles.
    issuer: Certificate,
    signing_key: KeyPair,
    /// DER de la CA (pour reconstruire des chaînes feuille + CA si besoin).
    pub cert_der: CertificateDer<'static>,
    leaf_cache: Mutex<HashMap<String, Arc<LeafCert>>>,
}

pub struct LeafCert {
    pub cert_der: CertificateDer<'static>,
    pub key_der: PrivatePkcs8KeyDer<'static>,
}

impl LocalCa {
    /// Charge la CA depuis le disque ou la génère (première exécution).
    pub fn load_or_create(dir: &PathBuf) -> Result<Arc<LocalCa>, AppError> {
        std::fs::create_dir_all(dir)
            .map_err(|e| AppError::Internal(format!("CA dir: {}", e)))?;
        let cert_path = dir.join("ca-cert.pem");
        let key_path = dir.join("ca-key.pem");

        if let (Ok(cert_pem), Ok(key_pem)) = (
            std::fs::read_to_string(&cert_path),
            std::fs::read_to_string(&key_path),
        ) {
            match Self::from_pems(&cert_pem, &key_pem) {
                Ok(ca) => return Ok(Arc::new(ca)),
                Err(err) => {
                    // PEM corrompus : régénérer (l'utilisateur devra
                    // réinstaller la CA dans son trust store).
                    eprintln!("[capture-https] CA files unreadable, regenerating: {}", err);
                }
            }
        }

        let ca = Self::generate()?;
        std::fs::write(&cert_path, &ca.cert_pem)
            .map_err(|e| AppError::Internal(format!("CA cert write: {}", e)))?;
        std::fs::write(&key_path, ca.signing_key.serialize_pem())
            .map_err(|e| AppError::Internal(format!("CA key write: {}", e)))?;
        Ok(Arc::new(ca))
    }

    fn from_pems(cert_pem: &str, key_pem: &str) -> Result<LocalCa, AppError> {
        let signing_key = KeyPair::from_pem(key_pem)
            .map_err(|e| AppError::Internal(format!("CA key parse: {}", e)))?;
        let (cert_der, _) = first_cert_pem_block(cert_pem)?;
        // Reconstruire l'émetteur rcgen pour signer les feuilles : mêmes
        // DN/validité que la CA générée (build_ca_params) + même clé. La
        // signature ECDSA de ring étant déterministe, le certificat
        // reconstruit est identique à celui sur le disque.
        let issuer = build_ca_params()
            .self_signed(&signing_key)
            .map_err(|e| AppError::Internal(format!("CA re-sign: {}", e)))?;
        Ok(LocalCa {
            cert_pem: cert_pem.to_string(),
            issuer,
            signing_key,
            cert_der,
            leaf_cache: Mutex::new(HashMap::new()),
        })
    }

    fn generate() -> Result<LocalCa, AppError> {
        let key = KeyPair::generate()
            .map_err(|e| AppError::Internal(format!("CA keygen: {}", e)))?;
        let issuer = build_ca_params()
            .self_signed(&key)
            .map_err(|e| AppError::Internal(format!("CA self-sign: {}", e)))?;
        let cert_pem = issuer.pem();
        let (cert_der, _) = first_cert_pem_block(&cert_pem)?;
        Ok(LocalCa {
            cert_pem,
            issuer,
            signing_key: key,
            cert_der,
            leaf_cache: Mutex::new(HashMap::new()),
        })
    }

    /// Certificat feuille pour `host`, généré à la volée et mis en cache.
    pub fn leaf_for(&self, host: &str) -> Result<Arc<LeafCert>, AppError> {
        if let Some(cached) = self.leaf_cache.lock()?.get(host) {
            return Ok(cached.clone());
        }
        let mut params = CertificateParams::default();
        params.distinguished_name.push(DnType::CommonName, host);
        params.subject_alt_names = vec![rcgen::SanType::DnsName(
            host.try_into().map_err(|_| {
                AppError::InvalidInput(format!("Nom d'hôte invalide : {}", host))
            })?,
        )];
        let key = KeyPair::generate()
            .map_err(|e| AppError::Internal(format!("leaf keygen: {}", e)))?;
        let cert = params
            .signed_by(&key, &self.issuer, &self.signing_key)
            .map_err(|e| AppError::Internal(format!("leaf sign: {}", e)))?;
        let leaf = Arc::new(LeafCert {
            cert_der: cert.der().to_owned(),
            key_der: PrivatePkcs8KeyDer::from(key.serialize_der()),
        });
        self.leaf_cache.lock()?.insert(host.to_string(), leaf.clone());
        Ok(leaf)
    }
}

/// Extrait la première PEM d'une chaîne (le certificat feuille/CA).
fn first_cert_pem_block(pem: &str) -> Result<(CertificateDer<'static>, String), AppError> {
    let marker_start = "-----BEGIN CERTIFICATE-----";
    let marker_end = "-----END CERTIFICATE-----";
    let start = pem
        .find(marker_start)
        .ok_or_else(|| AppError::Internal("PEM certificat absent".into()))?;
    let end = pem[start..]
        .find(marker_end)
        .ok_or_else(|| AppError::Internal("PEM certificat tronqué".into()))?
        + marker_end.len();
    let b64: String = pem[start + marker_start.len()..end - marker_end.len()]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    use base64::Engine as _;
    let der = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| AppError::Internal(format!("PEM base64: {}", e)))?;
    Ok((CertificateDer::from(der), pem.to_string()))
}

// ── Serveur d'interception ──────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCaInfo {
    pub path: String,
    pub exists: bool,
}

/// Handle du listener HTTPS (arrêt propre via le flag partagé).
pub struct HttpsProxyHandle {
    pub shutdown: Arc<AtomicBool>,
    pub addr: SocketAddr,
}

pub type ManagedHttpsProxyState = Arc<Mutex<Option<HttpsProxyHandle>>>;

pub fn ca_dir(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("capture-ca")
}

/// Infos CA pour l'UI (chemin à installer + présence sur le disque).
pub fn ca_info(app_data_dir: &PathBuf) -> CaptureCaInfo {
    let cert = ca_dir(app_data_dir).join("ca-cert.pem");
    CaptureCaInfo {
        path: cert.to_string_lossy().to_string(),
        exists: cert.exists(),
    }
}

pub fn start_https_proxy(
    emitter: CaptureEmitter,
    port: u16,
    state: ManagedCaptureProxyState,
    ca: Arc<LocalCa>,
    client: reqwest::Client,
) -> Result<HttpsProxyHandle, AppError> {
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|e| AppError::Internal(format!("tokio runtime: {}", e)))?;
    let listener = runtime
        .block_on(async { TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await })
        .map_err(|e| AppError::network(
            NetworkErrorKind::Unknown,
            format!("Le port {} est déjà utilisé. Choisissez un autre port.", port),
            format!("HTTPS capture bind: {}", e),
        ))?;
    let addr = listener
        .local_addr()
        .ok()
        .unwrap_or(SocketAddr::from(([127, 0, 0, 1], port)));

    let shutdown = Arc::new(AtomicBool::new(false));
    let handle = HttpsProxyHandle {
        shutdown: shutdown.clone(),
        addr,
    };
    let emitter = Arc::new(emitter);

    std::thread::spawn(move || {
        runtime.block_on(async move {
            loop {
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }
                let accepted = tokio::select! {
                    _ = poll_shutdown(shutdown.clone()) => break,
                    item = listener.accept() => item,
                };
                let Ok((stream, _)) = accepted else { continue };
                let task_emitter = emitter.clone();
                let task_state = state.clone();
                let task_ca = ca.clone();
                let task_client = client.clone();
                tokio::spawn(async move {
                    if let Err(err) =
                        handle_connection(task_emitter, task_state, task_ca, task_client, stream).await
                    {
                        eprintln!("[capture-https] connection error: {}", err);
                    }
                });
            }
        });
    });

    Ok(handle)
}

async fn poll_shutdown(shutdown: Arc<AtomicBool>) {
    loop {
        if shutdown.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[derive(Debug)]
enum FirstRead {
    /// `CONNECT host:port HTTP/1.1` — octets restants après l'entête.
    Connect { host: String, port: u16, rest: Vec<u8> },
    /// Requête HTTP ordinaire sur le port tunnel (non supporté en V1).
    PlainHttp,
}

async fn read_first_block(stream: &mut TcpStream) -> Result<FirstRead, AppError> {
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    loop {
        if let Some(pos) = find_headers_end(&buf) {
            let head = String::from_utf8_lossy(&buf[..pos]).to_string();
            let first_line = head.lines().next().unwrap_or("").to_string();
            if first_line.to_ascii_uppercase().starts_with("CONNECT ") {
                let authority = first_line
                    .split_whitespace()
                    .nth(1)
                    .ok_or_else(|| AppError::InvalidInput("CONNECT sans autorité".into()))?;
                let (host, port) = parse_authority(authority)?;
                return Ok(FirstRead::Connect {
                    host,
                    port,
                    rest: buf[pos + 4..].to_vec(),
                });
            }
            return Ok(FirstRead::PlainHttp);
        }
        let n = tokio::time::timeout(HEADER_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| AppError::Internal("header read timeout".into()))?
            .map_err(|e| AppError::Internal(format!("read: {}", e)))?;
        if n == 0 {
            return Err(AppError::Internal("client closed".into()));
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_HEAD_BUFFER {
            return Err(AppError::Internal("headers trop volumineux".into()));
        }
    }
}

fn find_headers_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_authority(authority: &str) -> Result<(String, u16), AppError> {
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().unwrap_or(443)),
        None => (authority.to_string(), 443),
    };
    if host.is_empty() {
        return Err(AppError::InvalidInput("CONNECT sans hôte".into()));
    }
    Ok((host, port))
}

async fn handle_connection(
    emitter: Arc<CaptureEmitter>,
    state: ManagedCaptureProxyState,
    ca: Arc<LocalCa>,
    client: reqwest::Client,
    mut stream: TcpStream,
) -> Result<(), AppError> {
    let first = read_first_block(&mut stream).await?;
    match first {
        FirstRead::Connect { host, port, rest } => {
            // La cible est un hôte arbitraire choisi par le client du proxy —
            // même politique anti-métadonnées que la capture HTTP.
            let target_url = reqwest::Url::parse(&format!("https://{}:{}", host, port))
                .map_err(|e| AppError::InvalidInput(format!("URL cible invalide: {}", e)))?;
            block_metadata_targets(&target_url).await?;

            stream
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .map_err(|e| AppError::Internal(format!("tunnel ack: {}", e)))?;

            // TLS côté client : chaîne feuille + CA (meilleure compatibilité
            // que la feuille seule chez les clients stricts).
            let leaf = ca.leaf_for(&host)?;
            let config = rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(
                    vec![leaf.cert_der.clone(), ca.cert_der.clone()],
                    PrivateKeyDer::Pkcs8(leaf.key_der.clone_key()),
                )
                .map_err(|e| AppError::Internal(format!("tls config: {}", e)))?;
            let acceptor = TlsAcceptor::from(Arc::new(config));
            let tls_stream = acceptor
                .accept(stream)
                .await
                .map_err(|e| AppError::Internal(format!("tls handshake: {}", e)))?;

            serve_inner_http(emitter, state, client, tls_stream, host, port, rest).await
        }
        FirstRead::PlainHttp => {
            // Proxy explicite HTTP (URL absolues) sur le même port : requis
            // pour qu'un navigateur pointant sur CE port puisse faire à la
            // fois du HTTP en clair et du CONNECT (HTTPS intercepté).
            serve_plain_http(emitter, state, client, stream).await
        }
    }
}

/// Boucle proxy HTTP en clair (requêtes en forme absolue).
async fn serve_plain_http<S>(
    emitter: Arc<CaptureEmitter>,
    state: ManagedCaptureProxyState,
    client: reqwest::Client,
    mut stream: S,
) -> Result<(), AppError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    // Leftover persistant : les octets pipelinés entre deux requêtes
    // ne doivent pas être perdus entre deux itérations.
    let mut leftover: Vec<u8> = Vec::new();
    loop {
        let Some((head, content_length)) = read_http_head(&mut stream, &mut leftover).await?
        else {
            return Ok(());
        };

        let head_str = String::from_utf8_lossy(&head).to_string();
        let mut lines = head_str.lines();
        let first_line = lines.next().unwrap_or_default().to_string();
        let mut parts = first_line.split_whitespace();
        let method = parts.next().unwrap_or("GET").to_string();
        let raw_url = parts.next().unwrap_or("/").to_string();

        let mut req_headers: Vec<(String, String)> = Vec::new();
        for line in lines {
            if let Some((name, value)) = line.split_once(':') {
                req_headers.push((name.trim().to_string(), value.trim().to_string()));
            }
        }
        if content_length > MAX_REQUEST_BODY {
            return Err(AppError::Internal("corps de requête trop volumineux".into()));
        }

        let mut body: Vec<u8> = Vec::new();
        if content_length > 0 {
            let mut chunk = [0u8; 8192];
            while body.len() < content_length {
                let n = tokio::time::timeout(BODY_TIMEOUT, stream.read(&mut chunk))
                    .await
                    .map_err(|_| AppError::Internal("body read timeout".into()))?
                    .map_err(|e| AppError::Internal(format!("body read: {}", e)))?;
                if n == 0 {
                    break;
                }
                let missing = content_length - body.len();
                body.extend_from_slice(&chunk[..n.min(missing)]);
            }
        }

        let body_str = String::from_utf8_lossy(&body).to_string();
        let filtered_headers = redact_headers(&req_headers);
        let mut captured = CapturedRequest::from_http_request(
            &method,
            &raw_url,
            &filtered_headers,
            Some(body_str.clone()),
        );
        emitter.captured(&captured);

        let start = Instant::now();
        let forward = forward_inner(
            &client,
            &method,
            &raw_url,
            &req_headers,
            if body.is_empty() { None } else { Some(&body) },
        )
        .await;

        match forward {
            Ok((status, resp_headers, resp_body)) => {
                captured.status = Some(status);
                captured.response_headers = Some(resp_headers.clone());
                captured.response_body =
                    Some(String::from_utf8_lossy(&resp_body).to_string());
                captured.duration_ms = Some(start.elapsed().as_millis() as u64);
                emitter.captured_updated(&captured);

                if let Ok(mut g) = state.lock() {
                    g.captured.push(captured);
                    if g.captured.len() > MAX_CAPTURED_SESSIONS {
                        let overflow = g.captured.len() - MAX_CAPTURED_SESSIONS;
                        g.captured.drain(0..overflow);
                    }
                    let _ = write_captures(&g.captured);
                }

                let mut response =
                    format!("HTTP/1.1 {} {}\r\n", status, reason_phrase(status));
                for (name, value) in &resp_headers {
                    let lower = name.to_ascii_lowercase();
                    if matches!(
                        lower.as_str(),
                        "transfer-encoding" | "content-length" | "connection"
                    ) {
                        continue;
                    }
                    response.push_str(&format!("{}: {}\r\n", name, value));
                }
                response.push_str(&format!("Content-Length: {}\r\n\r\n", resp_body.len()));
                stream.write_all(response.as_bytes()).await.ok();
                stream.write_all(&resp_body).await.ok();
                stream.flush().await.ok();
            }
            Err(e) => {
                captured.error = Some(e.user_message());
                captured.duration_ms = Some(start.elapsed().as_millis() as u64);
                emitter.captured_updated(&captured);
                let body = format!("Proxy error: {}", e.user_message());
                let response = format!(
                    "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream.write_all(response.as_bytes()).await.ok();
            }
        }
    }
}

/// Boucle HTTP/1.1 intérieure au tunnel TLS : lire → émettre → transmettre.
async fn serve_inner_http<S>(
    emitter: Arc<CaptureEmitter>,
    state: ManagedCaptureProxyState,
    client: reqwest::Client,
    mut tls: S,
    host: String,
    port: u16,
    mut leftover: Vec<u8>,
) -> Result<(), AppError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        let Some((head, content_length)) = read_http_head(&mut tls, &mut leftover).await? else {
            // Flux fermé proprement par le client.
            return Ok(());
        };

        let head_str = String::from_utf8_lossy(&head).to_string();
        let mut lines = head_str.lines();
        let first_line = lines.next().unwrap_or_default().to_string();
        let mut parts = first_line.split_whitespace();
        let method = parts.next().unwrap_or("GET").to_string();
        let path = parts.next().unwrap_or("/").to_string();

        let mut req_headers: Vec<(String, String)> = Vec::new();
        for line in lines {
            if let Some((name, value)) = line.split_once(':') {
                req_headers.push((name.trim().to_string(), value.trim().to_string()));
            }
        }
        if content_length > MAX_REQUEST_BODY {
            return Err(AppError::Internal("corps de requête trop volumineux".into()));
        }

        // Corps : les octets déjà lus (leftover) puis lecture complémentaire.
        let mut body: Vec<u8> = Vec::new();
        if content_length > 0 {
            let take = content_length.min(leftover.len());
            body.extend_from_slice(&leftover[..take]);
            leftover.drain(..take);
            let mut chunk = [0u8; 8192];
            while body.len() < content_length {
                let n = tokio::time::timeout(BODY_TIMEOUT, tls.read(&mut chunk))
                    .await
                    .map_err(|_| AppError::Internal("body read timeout".into()))?
                    .map_err(|e| AppError::Internal(format!("body read: {}", e)))?;
                if n == 0 {
                    break;
                }
                let missing = content_length - body.len();
                body.extend_from_slice(&chunk[..n.min(missing)]);
            }
        }

        let body_str = String::from_utf8_lossy(&body).to_string();
        let full_url = format!("https://{}:{}{}", host, port, path);
        let filtered_headers = redact_headers(&req_headers);

        let mut captured = CapturedRequest::from_http_request(
            &method,
            &full_url,
            &filtered_headers,
            Some(body_str.clone()),
        );
        emitter.captured(&captured);

        let start = Instant::now();
        let forward = forward_inner(
            &client,
            &method,
            &full_url,
            &req_headers,
            if body.is_empty() { None } else { Some(&body) },
        )
        .await;

        match forward {
            Ok((status, resp_headers, resp_body)) => {
                captured.status = Some(status);
                captured.response_headers = Some(resp_headers.clone());
                captured.response_body =
                    Some(String::from_utf8_lossy(&resp_body).to_string());
                captured.duration_ms = Some(start.elapsed().as_millis() as u64);
                emitter.captured_updated(&captured);
                if let Ok(mut g) = state.lock() {
                    g.captured.push(captured);
                    if g.captured.len() > MAX_CAPTURED_SESSIONS {
                        let overflow = g.captured.len() - MAX_CAPTURED_SESSIONS;
                        g.captured.drain(0..overflow);
                    }
                    let _ = write_captures(&g.captured);
                }

                // Réponse vers le client TLS (content-length recalculé).
                let mut response =
                    format!("HTTP/1.1 {} {}\r\n", status, reason_phrase(status));
                for (name, value) in &resp_headers {
                    let lower = name.to_ascii_lowercase();
                    if matches!(
                        lower.as_str(),
                        "transfer-encoding" | "content-length" | "connection"
                    ) {
                        continue;
                    }
                    response.push_str(&format!("{}: {}\r\n", name, value));
                }
                response.push_str(&format!("Content-Length: {}\r\n\r\n", resp_body.len()));
                tls.write_all(response.as_bytes()).await.ok();
                tls.write_all(&resp_body).await.ok();
                tls.flush().await.ok();
            }
            Err(e) => {
                captured.error = Some(e.user_message());
                captured.duration_ms = Some(start.elapsed().as_millis() as u64);
                emitter.captured_updated(&captured);
                let body = format!("Proxy error: {}", e.user_message());
                let response = format!(
                    "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                tls.write_all(response.as_bytes()).await.ok();
            }
        }
    }
}

/// Lit un entête HTTP/1.1 complet depuis le flux (en consommant `leftover`
/// d'abord). Renvoie (entête, content-length déclaré) ; `leftover` contient
/// ensuite les octets du corps déjà lus. Ok(None) = flux fermé.
async fn read_http_head<S>(
    tls: &mut S,
    leftover: &mut Vec<u8>,
) -> Result<Option<(Vec<u8>, usize)>, AppError>
where
    S: tokio::io::AsyncRead + Unpin,
{
    let mut fresh: Vec<u8> = Vec::new();
    loop {
        let mut combined: Vec<u8> = Vec::with_capacity(leftover.len() + fresh.len());
        combined.extend_from_slice(leftover);
        combined.extend_from_slice(&fresh);
        if let Some(pos) = find_headers_end(&combined) {
            let head = combined[..pos].to_vec();
            *leftover = combined[pos + 4..].to_vec();
            let head_str = String::from_utf8_lossy(&head).to_string();
            let mut content_length = 0usize;
            for line in head_str.lines().skip(1) {
                if let Some((name, value)) = line.split_once(':') {
                    if name.trim().eq_ignore_ascii_case("content-length") {
                        content_length = value.trim().parse().unwrap_or(0);
                    }
                }
            }
            return Ok(Some((head, content_length)));
        }
        let mut chunk = [0u8; 8192];
        let n = tokio::time::timeout(HEADER_TIMEOUT, tls.read(&mut chunk))
            .await
            .map_err(|_| AppError::Internal("inner header timeout".into()))?
            .map_err(|e| AppError::Internal(format!("inner read: {}", e)))?;
        if n == 0 {
            return Ok(None);
        }
        fresh.extend_from_slice(&chunk[..n]);
        if fresh.len() > MAX_HEAD_BUFFER {
            return Err(AppError::Internal("entêtes intérieurs trop volumineux".into()));
        }
    }
}

async fn forward_inner(
    client: &reqwest::Client,
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<&[u8]>,
) -> Result<(u16, Vec<(String, String)>, Vec<u8>), AppError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| AppError::InvalidInput(format!("URL invalide: {}", e)))?;
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| AppError::InvalidInput(format!("méthode invalide: {}", e)))?;
    let mut request = client.request(method, parsed);
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host" | "content-length" | "connection" | "proxy-connection" | "keep-alive"
        ) {
            continue;
        }
        if let Ok(v) = value.parse::<reqwest::header::HeaderValue>() {
            request = request.header(name.as_str(), v);
        }
    }
    if let Some(body) = body {
        request = request.body(body.to_vec());
    }
    let response = request
        .send()
        .await
        .map_err(|e| AppError::network(
            NetworkErrorKind::Unknown,
            "Requête vers le serveur en échec.",
            e.to_string(),
        ))?;
    let status = response.status().as_u16();
    let resp_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("lecture réponse: {}", e)))?;
    let mut body = bytes.to_vec();
    body.truncate(MAX_RESPONSE_BODY);
    Ok((status, resp_headers, body))
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

// ── Commandes Tauri ─────────────────────────────────────────────────────────

/// Infos sur la CA de capture (chemin + présence) pour l'UI d'installation.
#[tauri::command]
pub fn get_capture_ca_info(
    app_handle: AppHandle,
) -> Result<CaptureCaInfo, AppError> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app data dir: {}", e)))?;
    // Générer la CA au premier appel pour que le fichier à installer existe.
    LocalCa::load_or_create(&ca_dir(&dir))?;
    Ok(ca_info(&dir))
}

#[tauri::command]
pub fn start_capture_https_proxy(
    app_handle: AppHandle,
    port: u16,
    https_state: tauri::State<'_, ManagedHttpsProxyState>,
    capture_state: tauri::State<'_, ManagedCaptureProxyState>,
    client: tauri::State<'_, crate::fetch::SharedClient>,
) -> Result<String, AppError> {
    {
        let guard = https_state.lock()?;
        if guard.is_some() {
            return Err(AppError::InvalidInput(
                "Le proxy de capture HTTPS est déjà démarré".into(),
            ));
        }
    }
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app data dir: {}", e)))?;
    let ca = LocalCa::load_or_create(&ca_dir(&dir))?;

    let handle = start_https_proxy(
        CaptureEmitter::Tauri(app_handle),
        port,
        capture_state.inner().clone(),
        ca,
        client.normal.clone(),
    )?;
    let addr = handle.addr.to_string();
    *https_state.lock()? = Some(handle);
    Ok(addr)
}

#[tauri::command]
pub fn stop_capture_https_proxy(
    https_state: tauri::State<'_, ManagedHttpsProxyState>,
) -> Result<(), AppError> {
    if let Some(handle) = https_state.lock()?.take() {
        handle.shutdown.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_and_persists_a_ca() {
        let dir = tempfile::tempdir().unwrap();
        let ca1 = LocalCa::load_or_create(&dir.path().to_path_buf()).unwrap();
        let ca2 = LocalCa::load_or_create(&dir.path().to_path_buf()).unwrap();
        // Rechargée depuis le disque : même certificat.
        assert_eq!(ca1.cert_pem, ca2.cert_pem);
        assert!(ca1.cert_pem.contains("BEGIN CERTIFICATE"));
    }

    #[test]
    fn issues_leaf_certificates_per_host() {
        let dir = tempfile::tempdir().unwrap();
        let ca = LocalCa::load_or_create(&dir.path().to_path_buf()).unwrap();
        let leaf = ca.leaf_for("api.example.com").unwrap();
        let leaf2 = ca.leaf_for("api.example.com").unwrap();
        // Mise en cache : même DER pour le même host.
        assert_eq!(leaf.cert_der.as_ref(), leaf2.cert_der.as_ref());
        let other = ca.leaf_for("other.example.com").unwrap();
        assert_ne!(leaf.cert_der.as_ref(), other.cert_der.as_ref());
    }

    #[test]
    fn parses_connect_authorities() {
        assert_eq!(
            parse_authority("api.example.com:443").unwrap(),
            ("api.example.com".to_string(), 443)
        );
        assert_eq!(
            parse_authority("api.example.com").unwrap(),
            ("api.example.com".to_string(), 443)
        );
        assert!(parse_authority(":443").is_err());
    }

    #[test]
    fn rejects_unsafe_pem_blocks() {
        assert!(first_cert_pem_block("garbage").is_err());
        assert!(first_cert_pem_block("-----BEGIN CERTIFICATE-----").is_err());
    }
}
