//! Client gRPC sans codegen pour le desktop Reqly.
//!
//! Découvre les services via **server reflection**
//! (`grpc.reflection.v1alpha.ServerReflection`), charge les descripteurs
//! dans un pool `prost-reflect`, puis exécute des appels **unary** et
//! **server-streaming** en encodant des `DynamicMessage` — aucun .proto
//! compilé requis, comme Postman/Bruno.
//!
//! Transport : HTTP/2 manuel via hyper (framing gRPC : 1 octet compressé +
//! 4 octets big-endian de longueur par message). Plaintext (h2c) et TLS
//! rustls. Les requêtes et cibles passent par la garde anti-métadonnées
//! cloud du produit.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use http_body_util::BodyExt;
use prost_reflect::prost::encoding::encode_varint;
use prost_reflect::prost::Message;
use prost_reflect::prost_types::{FileDescriptorProto, FileDescriptorSet};
use prost_reflect::{DeserializeOptions, DescriptorPool, DynamicMessage, MethodDescriptor, SerializeOptions};
use serde::Serialize;
use tokio::net::TcpStream;

use crate::capture::block_metadata_targets;
use crate::error::{AppError, NetworkErrorKind};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;
const MAX_REFLECTION_ROUNDS: usize = 32;
const REFLECTION_PATH: &str = "grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo";
/// Code 0 : OK.
const GRPC_STATUS_OK: &str = "0";

// ── Types exposés au front ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMethodInfo {
    pub name: String,
    /// true = server-streaming.
    pub server_streaming: bool,
    /// Squelette JSON du message d'entrée (tous champs avec valeurs par défaut).
    pub input_example: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcServiceInfo {
    /// Nom complet : `package.Service`.
    pub name: String,
    pub methods: Vec<GrpcMethodInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCallResult {
    /// ok | error (statut gRPC de fin de flux).
    pub status: String,
    pub grpc_status_code: String,
    pub grpc_message: String,
    pub headers: Vec<(String, String)>,
    /// Réponse(s) — plusieurs pour le server-streaming.
    pub responses: Vec<serde_json::Value>,
    pub duration_ms: u64,
}

/// Descripteurs résolus par cible (`host:port`).
#[derive(Default)]
pub struct GrpcDescriptorState {
    targets: Mutex<HashMap<String, Arc<DescriptorPool>>>,
}

// ── Garde de cible ──────────────────────────────────────────────────────────

fn validate_grpc_url(raw: &str) -> Result<reqwest::Url, AppError> {
    let url = reqwest::Url::parse(raw.trim())
        .map_err(|e| AppError::InvalidInput(format!("URL gRPC invalide : {}", e)))?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(AppError::InvalidInput(format!(
            "Schéma refusé : {}. Seuls http:// (h2c) et https:// sont autorisés.",
            scheme
        )));
    }
    if url.host_str().is_none() {
        return Err(AppError::InvalidInput("URL gRPC sans hôte".into()));
    }
    Ok(url)
}

// ── Connexion HTTP/2 ────────────────────────────────────────────────────────

trait AsyncStream: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + Unpin {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + Unpin> AsyncStream for T {}

#[derive(Clone, Copy)]
struct TokioSpawnExecutor;

impl<F: std::future::Future + Send + 'static> hyper::rt::Executor<F> for TokioSpawnExecutor
where
    F::Output: Send + 'static,
{
    fn execute(&self, fut: F) {
        tokio::spawn(fut);
    }
}

async fn connect_h2(
    url: &reqwest::Url,
) -> Result<hyper::client::conn::http2::SendRequest<http_body_util::Full<bytes::Bytes>>, AppError> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::InvalidInput("hôte absent".into()))?
        .to_string();
    let port = url
        .port_or_known_default()
        .unwrap_or(if url.scheme() == "https" { 443 } else { 80 });

    let addr = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| AppError::network(
            NetworkErrorKind::DnsResolutionFailed,
            "Résolution DNS en échec.",
            e.to_string(),
        ))?
        .next()
        .ok_or_else(|| AppError::network(
            NetworkErrorKind::DnsResolutionFailed,
            "Aucune adresse résolue.",
            host.clone(),
        ))?;
    let tcp = TcpStream::connect(addr).await.map_err(|e| AppError::network(
        NetworkErrorKind::ConnectionRefused,
        "Connexion TCP en échec.",
        e.to_string(),
    ))?;
    tcp.set_nodelay(true).ok();

    let io: Box<dyn AsyncStream> = if url.scheme() == "https" {
        let mut roots = rustls::RootCertStore::empty();
        for cert in rustls_native_certs::load_native_certs().certs {
            let _ = roots.add(cert);
        }
        let tls = tokio_rustls::TlsConnector::from(Arc::new(
            rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth(),
        ));
        let server_name = rustls::pki_types::ServerName::try_from(host.clone())
            .map_err(|_| AppError::InvalidInput(format!("Nom de serveur invalide : {}", host)))?;
        Box::new(
            tls.connect(server_name, tcp)
                .await
                .map_err(|e| AppError::network(
                    NetworkErrorKind::TlsHandshakeFailed,
                    "Échec de la négociation TLS.",
                    e.to_string(),
                ))?,
        )
    } else {
        Box::new(tcp)
    };

    let (send_request, connection) =
        hyper::client::conn::http2::Builder::new(TokioSpawnExecutor)
            .handshake(hyper_util::rt::TokioIo::new(io))
            .await
            .map_err(|e| AppError::Internal(format!("handshake h2 : {}", e)))?;

    // Driver h2 : tâche dédiée, comme dans la doc hyper.
    tokio::spawn(async move {
        let _ = connection.await;
    });

    Ok(send_request)
}

// ── Framing gRPC ────────────────────────────────────────────────────────────

fn frame_message(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 5);
    out.push(0u8); // pas de compression
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

#[derive(Debug)]
#[allow(dead_code)] // compressed: pas de décompression supportée en V1 (identity only)
struct GrpcMessage {
    compressed: bool,
    payload: Vec<u8>,
}

fn parse_frame(buf: &mut Vec<u8>) -> Option<GrpcMessage> {
    if buf.len() < 5 {
        return None;
    }
    let compressed = buf[0] == 1;
    let len = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]) as usize;
    if len > MAX_MESSAGE_SIZE {
        return None;
    }
    if buf.len() < 5 + len {
        return None;
    }
    let payload = buf[5..5 + len].to_vec();
    buf.drain(..5 + len);
    Some(GrpcMessage { compressed, payload })
}

// ── Appel HTTP/2 brut (unary + reflection via streaming) ────────────────────

struct RawResponse {
    headers: Vec<(String, String)>,
    grpc_status: Option<String>,
    grpc_message: Option<String>,
    /// Messages déframés au fil de l'eau.
    messages: Vec<Vec<u8>>,
}

async fn raw_grpc_request(
    url: &reqwest::Url,
    path: &str,
    payload: &[u8],
    metadata: &[(String, String)],
    collect_messages: bool,
) -> Result<RawResponse, AppError> {
    let mut send_request = connect_h2(url).await?;
    tokio::time::timeout(DEFAULT_TIMEOUT, send_request.ready())
        .await
        .map_err(|_| AppError::network(NetworkErrorKind::ConnectionTimeout, "Canal h2 non prêt.", String::new()))?
        .map_err(|e| AppError::network(NetworkErrorKind::ConnectionReset, "Canal h2 fermé.", e.to_string()))?;

    // hyper 1 exige une URI absolue : les pseudo-headers h2 (:scheme,
    // :authority) en sont dérivés.
    let request_uri: hyper::Uri = format!(
        "{}://{}/{}",
        url.scheme(),
        url.authority(),
        path.trim_start_matches('/')
    )
    .parse()
    .map_err(|e| AppError::Internal(format!("URI gRPC invalide : {}", e)))?;
    let mut builder = hyper::Request::builder()
        .method(hyper::Method::POST)
        .uri(request_uri)
        .version(hyper::Version::HTTP_2)
        .header("content-type", "application/grpc")
        .header("te", "trailers")
        .header("user-agent", "reqly-grpc/1.0");
    for (name, value) in metadata {
        if !name.is_empty() {
            builder = builder.header(name.as_str(), value.as_str());
        }
    }
    let request = builder
        .body(http_body_util::Full::new(bytes::Bytes::from(frame_message(payload))))
        .map_err(|e| AppError::Internal(format!("requête h2 : {}", e)))?;

    let started = Instant::now();
    let response = tokio::time::timeout(DEFAULT_TIMEOUT, send_request.send_request(request))
        .await
        .map_err(|_| AppError::network(NetworkErrorKind::ConnectionTimeout, "Timeout de l'appel gRPC.", String::new()))?
        .map_err(|e| {
            let mut detail = e.to_string();
            let mut src = std::error::Error::source(&e);
            while let Some(s) = src {
                detail.push_str(" <- ");
                detail.push_str(&s.to_string());
                src = s.source();
            }
            eprintln!("[grpc] send_request failed: {}", detail);
            AppError::network(NetworkErrorKind::ConnectionReset, "Canal h2 fermé.", detail)
        })?;

    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let mut grpc_status = response
        .headers()
        .get("grpc-status")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let mut grpc_message = response
        .headers()
        .get("grpc-message")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode);

    let mut body = response.into_body();
    let mut buffer: Vec<u8> = Vec::new();
    let mut messages: Vec<Vec<u8>> = Vec::new();

    loop {
        // frame() → Option<Result<Frame, hyper::Error>> : None = fin de flux.
        let frame = match tokio::time::timeout(DEFAULT_TIMEOUT, body.frame()).await {
            Err(_) => {
                return Err(AppError::network(
                    NetworkErrorKind::ConnectionTimeout,
                    "Timeout de lecture du flux gRPC.",
                    String::new(),
                ));
            }
            Ok(None) => break,
            Ok(Some(Ok(frame))) => frame,
            Ok(Some(Err(e))) => {
                return Err(AppError::network(
                    NetworkErrorKind::ConnectionReset,
                    "Flux gRPC interrompu.",
                    e.to_string(),
                ));
            }
        };
        if let Some(trailers) = frame.trailers_ref() {
            if grpc_status.is_none() {
                grpc_status = trailers
                    .get("grpc-status")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
            }
            if grpc_message.is_none() {
                grpc_message = trailers
                    .get("grpc-message")
                    .and_then(|v| v.to_str().ok())
                    .map(percent_decode);
            }
            continue;
        }
        if let Some(data) = frame.data_ref() {
            buffer.extend_from_slice(data);
            if buffer.len() > MAX_MESSAGE_SIZE {
                return Err(AppError::Internal("Réponse gRPC trop volumineuse".into()));
            }
            if collect_messages {
                while let Some(msg) = parse_frame(&mut buffer) {
                    messages.push(msg.payload);
                }
            }
        }
    }
    let _ = started;

    Ok(RawResponse { headers, grpc_status, grpc_message, messages })
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"),
                16,
            ) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

// ── Décodage manuel de la réponse de reflection ─────────────────────────────

/// Petit lecteur protobuf wire-format (champs de ServerReflectionResponse).
struct WireReader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> WireReader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        WireReader { buf, pos: 0 }
    }

    fn read_varint(&mut self) -> Option<u64> {
        let mut value: u64 = 0;
        let mut shift = 0;
        while self.pos < self.buf.len() {
            let byte = self.buf[self.pos];
            self.pos += 1;
            value |= ((byte & 0x7f) as u64) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
            shift += 7;
            if shift > 63 {
                return None;
            }
        }
        None
    }

    fn read_bytes(&mut self) -> Option<&'a [u8]> {
        let len = self.read_varint()? as usize;
        if self.pos + len > self.buf.len() {
            return None;
        }
        let out = &self.buf[self.pos..self.pos + len];
        self.pos += len;
        Some(out)
    }

    /// Itère les champs (numéro, wire type) avec la valeur brute pour les
    /// length-delimited.
    fn next_field(&mut self) -> Option<(u32, u8, &'a [u8])> {
        if self.pos >= self.buf.len() {
            return None;
        }
        let key = self.read_varint()?;
        let field = (key >> 3) as u32;
        let wire = (key & 0x7) as u8;
        match wire {
            0 => {
                let start = self.pos;
                self.read_varint()?;
                Some((field, wire, &self.buf[start..self.pos]))
            }
            1 => {
                if self.pos + 8 > self.buf.len() {
                    return None;
                }
                let out = &self.buf[self.pos..self.pos + 8];
                self.pos += 8;
                Some((field, wire, out))
            }
            2 => {
                let content = self.read_bytes()?;
                Some((field, wire, content))
            }
            5 => {
                if self.pos + 4 > self.buf.len() {
                    return None;
                }
                let out = &self.buf[self.pos..self.pos + 4];
                self.pos += 4;
                Some((field, wire, out))
            }
            _ => None,
        }
    }
}

/// Extracteur de FileDescriptorProtos / noms de services depuis une
/// ServerReflectionResponse.
struct ReflectionResponse {
    files: Vec<FileDescriptorProto>,
    service_names: Vec<String>,
}

fn parse_reflection_response(bytes: &[u8]) -> ReflectionResponse {
    let mut files = Vec::new();
    let mut service_names = Vec::new();
    let mut reader = WireReader::new(bytes);
    while let Some((field, _, content)) = reader.next_field() {
        match field {
            // 5 = file_descriptor_response { repeated file_descriptor_proto = 1 }
            5 => {
                let mut sub = WireReader::new(content);
                while let Some((f2, _, fd)) = sub.next_field() {
                    if f2 == 1 {
                        if let Ok(fd) = FileDescriptorProto::decode(fd) {
                            files.push(fd);
                        }
                    }
                }
            }
            // 7 = list_services_response { repeated ServiceResponse service = 1 { name = 1 } }
            7 => {
                let mut sub = WireReader::new(content);
                while let Some((f2, _, service)) = sub.next_field() {
                    if f2 == 1 {
                        let mut svc = WireReader::new(service);
                        while let Some((f3, _, name)) = svc.next_field() {
                            if f3 == 1 {
                                service_names.push(String::from_utf8_lossy(name).to_string());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    ReflectionResponse { files, service_names }
}

/// Encodage manuel de ServerReflectionRequest { file_containing_symbol = 3 }.
fn reflection_request_for_symbol(symbol: &str) -> Vec<u8> {
    let mut out = Vec::new();
    encode_varint((3u64 << 3) | 2, &mut out);
    encode_varint(symbol.len() as u64, &mut out);
    out.extend_from_slice(symbol.as_bytes());
    out
}

/// Encodage manuel de ServerReflectionRequest { list_services = 7 } (champ
/// string dont la valeur attendue est "").
fn reflection_request_list_services() -> Vec<u8> {
    let mut out = Vec::new();
    encode_varint((7u64 << 3) | 2, &mut out);
    encode_varint(0u64, &mut out);
    out
}

// ── Résolution de descripteurs ──────────────────────────────────────────────

fn file_names_in(fd: &FileDescriptorProto) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(name) = &fd.name {
        out.push(name.clone());
    }
    out.extend(fd.dependency.iter().cloned());
    out
}

/// Résout le pool de descripteurs d'une cible via reflection : listage des
/// services, puis récupération des fichiers par symbole et par nom (avec
/// leurs dépendances) jusqu'à pouvoir construire un pool complet.
async fn resolve_descriptors(url: &reqwest::Url) -> Result<DescriptorPool, AppError> {
    block_metadata_targets(url).await?;

    let mut all_files: Vec<FileDescriptorProto> = Vec::new();
    let mut known_files: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut service_names: Vec<String> = Vec::new();

    // 1. Liste des services.
    let response = raw_grpc_request(url, REFLECTION_PATH, &reflection_request_list_services(), &[], true).await?;
    require_grpc_ok(&response, "list_services")?;
    for msg in &response.messages {
        let parsed = parse_reflection_response(msg);
        service_names.extend(parsed.service_names);
        for fd in parsed.files {
            for name in file_names_in(&fd) {
                known_files.insert(name);
            }
            all_files.push(fd);
        }
    }
    if service_names.is_empty() {
        return Err(AppError::Internal(
            "Le serveur n'expose pas la réflexion gRPC ou ne déclare aucun service".into(),
        ));
    }
    // La réflexion renvoie un service interne à exclure du listing utilisateur.
    service_names.retain(|s| s != "grpc.reflection.v1alpha.ServerReflection" && s != "grpc.reflection.v1.ServerReflection");

    // 2. Descripteurs par symbole de service + résolution des dépendances.
    let mut pending_symbols: Vec<String> = service_names.clone();
    let mut rounds = 0;
    while (!pending_symbols.is_empty() || missing_dependencies(&all_files, &known_files)) && rounds < MAX_REFLECTION_ROUNDS {
        rounds += 1;

        let symbols = std::mem::take(&mut pending_symbols);
        for symbol in symbols {
            let response = raw_grpc_request(
                url,
                REFLECTION_PATH,
                &reflection_request_for_symbol(&symbol),
                &[],
                true,
            )
            .await?;
            require_grpc_ok(&response, &symbol)?;
            for msg in &response.messages {
                let parsed = parse_reflection_response(msg);
                for fd in parsed.files {
                    for name in file_names_in(&fd) {
                        known_files.insert(name);
                    }
                    all_files.push(fd);
                }
            }
        }

        // Dépendances manquantes → file_by_filename (champ 6).
        let mut missing: Vec<String> = Vec::new();
        for fd in &all_files {
            for dep in &fd.dependency {
                if !known_files.contains(dep) {
                    missing.push(dep.clone());
                }
            }
        }
        missing.dedup();
        for file in missing {
            known_files.insert(file.clone());
            let request = encode_field_values(&[(6u32, file.as_bytes())]);
            let response = raw_grpc_request(url, REFLECTION_PATH, &request, &[], true).await?;
            require_grpc_ok(&response, &file)?;
            for msg in &response.messages {
                let parsed = parse_reflection_response(msg);
                for fd in parsed.files {
                    for name in file_names_in(&fd) {
                        known_files.insert(name);
                    }
                    all_files.push(fd);
                }
            }
        }
        // Sans nouveaux symboles, la boucle se termine via
        // missing_dependencies (les fichiers manquants sont marqués connus).
    }

    let set = FileDescriptorSet { file: all_files };
    let pool = DescriptorPool::decode(set.encode_to_vec().as_slice())
        .map_err(|e| AppError::Internal(format!("Descripteurs incomplets : {}", e)))?;
    Ok(pool)
}

fn encode_field_values(fields: &[(u32, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    for (field, value) in fields {
        encode_varint(((*field as u64) << 3) | 2, &mut out);
        encode_varint(value.len() as u64, &mut out);
        out.extend_from_slice(value);
    }
    out
}

fn missing_dependencies(files: &[FileDescriptorProto], known: &std::collections::HashSet<String>) -> bool {
    files
        .iter()
        .any(|fd| fd.dependency.iter().any(|dep| !known.contains(dep)))
}

fn require_grpc_ok(response: &RawResponse, context: &str) -> Result<(), AppError> {
    match response.grpc_status.as_deref() {
        Some(code) if code == GRPC_STATUS_OK => Ok(()),
        Some(code) => Err(AppError::Internal(format!(
            "Réflexion gRPC refusée pour {} (grpc-status {} : {})",
            context,
            code,
            response.grpc_message.as_deref().unwrap_or("sans message")
        ))),
        None => Err(AppError::Internal(format!(
            "Réflexion gRPC sans statut pour {} (HTTP {})",
            context,
            response
                .headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(":status"))
                .map(|(_, v)| v.as_str())
                .unwrap_or("?")
        ))),
    }
}

// ── Méthodes et appels ──────────────────────────────────────────────────────

fn find_method(
    pool: &DescriptorPool,
    full_method_name: &str,
) -> Result<MethodDescriptor, AppError> {
    // `package.Service/Method` → "package.Service.Method".
    let dotted = full_method_name.replace('/', ".");
    let (service_name, method_name) = dotted
        .rsplit_once('.')
        .map(|(s, m)| (s.to_string(), m.to_string()))
        .ok_or_else(|| {
            AppError::InvalidInput(format!("Nom de méthode gRPC invalide : {}", full_method_name))
        })?;
    let service = pool
        .get_service_by_name(&service_name)
        .ok_or_else(|| AppError::InvalidInput(format!("Service introuvable : {}", service_name)))?;
    let found = service
        .methods()
        .find(|m| m.name() == method_name);
    drop(service);
    found.ok_or_else(|| AppError::InvalidInput(format!(
        "Méthode {} introuvable dans {}",
        method_name, service_name
    )))
}

fn to_json(msg: &DynamicMessage) -> serde_json::Value {
    let options = SerializeOptions::new().skip_default_fields(false);
    msg.serialize_with_options(serde_json::value::Serializer, &options)
        .unwrap_or(serde_json::Value::Object(Default::default()))
}

fn method_info(_pool: &DescriptorPool, method: &MethodDescriptor) -> GrpcMethodInfo {
    let example = DynamicMessage::decode(method.input(), &Vec::new()[..])
        .map(|msg| to_json(&msg))
        .unwrap_or(serde_json::Value::Object(Default::default()));
    GrpcMethodInfo {
        name: method.name().to_string(),
        server_streaming: method.is_server_streaming(),
        input_example: example,
    }
}

// ── Commandes Tauri ─────────────────────────────────────────────────────────

/// Liste les services d'une cible gRPC via la réflexion serveur.
#[tauri::command]
pub async fn grpc_list_services(
    url: String,
    state: tauri::State<'_, GrpcDescriptorState>,
) -> Result<Vec<GrpcServiceInfo>, AppError> {
    let url = validate_grpc_url(&url)?;
    let pool = Arc::new(resolve_descriptors(&url).await?);
    let cache_key = format!("{}://{}", url.scheme(), url.authority());
    state
        .targets
        .lock()
        .map_err(|_| AppError::Internal("état gRPC verrouillé".into()))?
        .insert(cache_key, pool.clone());

    let mut services = Vec::new();
    for service in pool.services() {
        let mut methods = Vec::new();
        for method in service.methods() {
            methods.push(method_info(&pool, &method));
        }
        services.push(GrpcServiceInfo {
            name: service.full_name().to_string(),
            methods,
        });
    }
    services.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(services)
}

/// Exécute un appel gRPC (unary ou server-streaming) sur un DynamicMessage.
#[tauri::command]
pub async fn grpc_call(
    url: String,
    method: String,
    payload_json: String,
    metadata: Option<Vec<(String, String)>>,
    state: tauri::State<'_, GrpcDescriptorState>,
) -> Result<GrpcCallResult, AppError> {
    let url = validate_grpc_url(&url)?;
    block_metadata_targets(&url).await?;
    let metadata = metadata.unwrap_or_default();

    let cache_key = format!("{}://{}", url.scheme(), url.authority());
    let pool = {
        let map = state
            .targets
            .lock()
            .map_err(|_| AppError::Internal("état gRPC verrouillé".into()))?;
        map.get(&cache_key)
            .cloned()
            .ok_or_else(|| AppError::InvalidInput(
                "Services non résolus — lance d'abord la découverte sur cette cible".into(),
            ))?
    };

    let method_descriptor = find_method(&pool, &method)?;
    let input = method_descriptor.input();
    // DynamicMessage::deserialize consomme un serde Deserializer générique.
    let mut de = serde_json::Deserializer::from_str(&payload_json);
    let message = DynamicMessage::deserialize(input.clone(), &mut de)
        .map_err(|e| AppError::InvalidInput(format!("Payload incompatible avec le schéma : {}", e)))?;
    de.end()
        .map_err(|e| AppError::InvalidInput(format!("JSON du payload invalide : {}", e)))?;

    let call_started = Instant::now();
    let payload_bytes = message.encode_to_vec();
    let response = raw_grpc_request(
        &url,
        &method,
        &payload_bytes,
        &metadata,
        true,
    )
    .await?;

    let mut responses = Vec::new();
    for msg_payload in &response.messages {
        match DynamicMessage::decode(input.clone(), msg_payload.as_slice()) {
            Ok(msg) => responses.push(to_json(&msg)),
            Err(e) => responses.push(serde_json::Value::String(format!(
                "décodage protobuf impossible : {}",
                e
            ))),
        }
    }

    // Un statut manquant dans les trailers = flux interrompu (erreur).
    let status = if response.grpc_status.as_deref() == Some(GRPC_STATUS_OK) {
        "ok"
    } else {
        "error"
    }
    .to_string();

    Ok(GrpcCallResult {
        status,
        grpc_status_code: response.grpc_status.unwrap_or_else(|| "?".into()),
        grpc_message: response.grpc_message.unwrap_or_default(),
        headers: response.headers,
        responses,
        duration_ms: call_started.elapsed().as_millis() as u64,
    })
}

// Éléments utilisés par le parsing des messages (requis pour l'option
// « dénier les champs inconnus » côté front).
#[allow(dead_code)]
fn deserialize_options() -> DeserializeOptions {
    DeserializeOptions::new().deny_unknown_fields(false)
}

// ── Helpers de test (hors binaires Tauri, sans tauri::State) ───────────────

#[doc(hidden)]
pub mod __test {
    use super::*;

    pub async fn list_services(url: &str) -> Result<Vec<GrpcServiceInfo>, AppError> {
        let url = validate_grpc_url(url)?;
        let pool = Arc::new(resolve_descriptors(&url).await?);
        let mut services = Vec::new();
        for service in pool.services() {
            let mut methods = Vec::new();
            for method in service.methods() {
                methods.push(method_info(&pool, &method));
            }
            services.push(GrpcServiceInfo {
                name: service.full_name().to_string(),
                methods,
            });
        }
        services.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(services)
    }

    pub async fn call(
        url: &str,
        method: &str,
        payload_json: &str,
        metadata: &[(String, String)],
    ) -> Result<GrpcCallResult, AppError> {
        let url = validate_grpc_url(url)?;
        block_metadata_targets(&url).await?;

        let pool = Arc::new(resolve_descriptors(&url).await?);
        let method_descriptor = find_method(&pool, method)?;
        let input = method_descriptor.input();
        let mut de = serde_json::Deserializer::from_str(payload_json);
        let message = DynamicMessage::deserialize(input.clone(), &mut de)
            .map_err(|e| AppError::InvalidInput(format!("Payload incompatible : {}", e)))?;
        de.end()
            .map_err(|e| AppError::InvalidInput(format!("JSON invalide : {}", e)))?;

        let started = Instant::now();
        let payload_bytes = message.encode_to_vec();
        let response = raw_grpc_request(&url, method, &payload_bytes, metadata, true).await?;

        let mut responses = Vec::new();
        for msg_payload in &response.messages {
            match DynamicMessage::decode(input.clone(), msg_payload.as_slice()) {
                Ok(msg) => responses.push(to_json(&msg)),
                Err(e) => responses.push(serde_json::Value::String(format!(
                    "décodage protobuf impossible : {}",
                    e
                ))),
            }
        }
        let status = if response.grpc_status.as_deref() == Some(GRPC_STATUS_OK) {
            "ok"
        } else {
            "error"
        };
        Ok(GrpcCallResult {
            status: status.to_string(),
            grpc_status_code: response.grpc_status.unwrap_or_else(|| "?".into()),
            grpc_message: response.grpc_message.unwrap_or_default(),
            headers: response.headers,
            responses,
            duration_ms: started.elapsed().as_millis() as u64,
        })
    }
}
