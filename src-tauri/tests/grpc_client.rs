//! Tests d'intégration du client gRPC (src/grpc.rs) contre un serveur gRPC
//! minimal implémenté en hyper : réflexion v1alpha + méthode echo unary.

use prost_reflect::prost::Message;
use prost_reflect::prost_types::FileDescriptorSet;

// ── Descripteurs du service de test (echo.proto) ────────────────────────────

fn descriptor_set() -> FileDescriptorSet {
    // Compilation dynamique : on encode le FileDescriptorProto à la main.
    // Simpler : prost-types ne parse pas le .proto. On construit donc le
    // descriptor via DescriptorPool::decode d'un FileDescriptorSet encodé
    // par prost-types — il faut le construire en Rust.
    let mut file = prost_reflect::prost_types::FileDescriptorProto::default();
    file.name = Some("echo.proto".to_string());
    file.package = Some("reqly.test".to_string());
    file.syntax = Some("proto3".to_string());
    file.message_type.push(prost_reflect::prost_types::DescriptorProto {
        name: Some("EchoRequest".to_string()),
        field: vec![prost_reflect::prost_types::FieldDescriptorProto {
            name: Some("text".to_string()),
            number: Some(1),
            label: Some(prost_reflect::prost_types::field_descriptor_proto::Label::Optional as i32),
            r#type: Some(prost_reflect::prost_types::field_descriptor_proto::Type::String as i32),
            ..Default::default()
        }],
        ..Default::default()
    });
    file.service.push(prost_reflect::prost_types::ServiceDescriptorProto {
        name: Some("Echo".to_string()),
        method: vec![prost_reflect::prost_types::MethodDescriptorProto {
            name: Some("Say".to_string()),
            input_type: Some(".reqly.test.EchoRequest".to_string()),
            output_type: Some(".reqly.test.EchoRequest".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    });
    FileDescriptorSet { file: vec![file] }
}

// ── Encodage de ServerReflectionResponse (wire format manuel) ───────────────

fn len_delimited(field: u32, content: &[u8], out: &mut Vec<u8>) {
    let key = (field << 3) | 2;
    encode_varint(key as u64, out);
    encode_varint(content.len() as u64, out);
    out.extend_from_slice(content);
}

fn encode_varint(mut value: u64, out: &mut Vec<u8>) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

/// ServerReflectionResponse pour une demande `list_services`.
fn list_services_response(services: &[&str]) -> Vec<u8> {
    let mut service_list = Vec::new();
    for name in services {
        let mut svc = Vec::new();
        len_delimited(1, name.as_bytes(), &mut svc);
        let mut outer = Vec::new();
        len_delimited(1, &svc, &mut outer);
        service_list.extend(outer);
    }
    let mut response = Vec::new();
    // valid_host = 1 (string, ignoré) ; list_services_response = 7
    len_delimited(7, &service_list, &mut response);
    response
}

/// ServerReflectionResponse pour `file_containing_symbol` : on renvoie le
/// FileDescriptorSet encodé (un FileDescriptorProto par champ).
fn file_by_symbol_response(set: &FileDescriptorSet) -> Vec<u8> {
    let mut fd_list = Vec::new();
    for file in &set.file {
        let encoded = file.encode_to_vec();
        let mut one = Vec::new();
        len_delimited(1, &encoded, &mut one);
        fd_list.extend(one);
    }
    let mut response = Vec::new();
    len_delimited(5, &fd_list, &mut response);
    response
}

// ── Serveur gRPC minimal (hyper) ────────────────────────────────────────────

fn decode_grpc_frames(buf: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut pos = 0;
    while pos + 5 <= buf.len() {
        let len = u32::from_be_bytes([buf[pos + 1], buf[pos + 2], buf[pos + 3], buf[pos + 4]]) as usize;
        if pos + 5 + len > buf.len() {
            break;
        }
        out.push(buf[pos + 5..pos + 5 + len].to_vec());
        pos += 5 + len;
    }
    out
}

fn grpc_frame(payload: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8];
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

async fn serve_grpc_test_server(listener: tokio::net::TcpListener, set: FileDescriptorSet) {
    // Executeur h2 pour hyper (spawn des tâches de connexion).
    #[derive(Clone, Copy)]
    struct TestExecutor;
    impl<F: std::future::Future + Send + 'static> hyper::rt::Executor<F> for TestExecutor
    where
        F::Output: Send + 'static,
    {
        fn execute(&self, fut: F) {
            tokio::spawn(fut);
        }
    }
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        eprintln!("[test-server] accepted connection");
        let io = hyper_util::rt::TokioIo::new(stream);
        let set = set.clone();
        tokio::spawn(async move {
            let service = hyper::service::service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                let set = set.clone();
                async move {
                    let path = req.uri().path().to_string();
                    let full = http_body_util::BodyExt::collect(req.into_body())
                        .await
                        .map(|b| b.to_bytes())
                        .unwrap_or_default();
                    let frames = decode_grpc_frames(&full);

                    let ok = !path.ends_with("ServerReflectionInfo") || true;
                    let _ = ok;
                    let mut builder = hyper::Response::builder()
                        .status(200)
                        .header("content-type", "application/grpc")
                        .header("grpc-status", "0");
                    let mut body_bytes: Vec<u8> = Vec::new();
                    let trailers_needed = true;

                    if path.ends_with("ServerReflectionInfo") {
                        let request = frames.first().cloned().unwrap_or_default();
                        let symbol = read_reflection_symbol(&request);
                        match symbol {
                            ReflectionQuery::ListServices => {
                                body_bytes =
                                    grpc_frame(&list_services_response(&["reqly.test.Echo"]));
                            }
                            ReflectionQuery::Symbol(_) => {
                                body_bytes = grpc_frame(&file_by_symbol_response(&set));
                            }
                        }
                    } else if path == "/reqly.test.Echo/Say" {
                        body_bytes = grpc_frame(frames.first().map(|f| f.as_slice()).unwrap_or(&[]));
                    } else {
                        builder = hyper::Response::builder()
                            .status(200)
                            .header("content-type", "application/grpc")
                            .header("grpc-status", "12");
                    }
                    let _ = trailers_needed;

                    // gRPC exige les trailers à la fin du flux. Full<T> ne
                    // peut pas porter de trailers — un body custom les émet.
                    use http_body_util::BodyExt as _;
                    struct GrpcBody {
                        data: bytes::Bytes,
                        sent: bool,
                    }
                    impl hyper::body::Body for GrpcBody {
                        type Data = bytes::Bytes;
                        type Error = std::convert::Infallible;
                        fn poll_frame(
                            mut self: std::pin::Pin<&mut Self>,
                            _cx: &mut std::task::Context<'_>,
                        ) -> std::task::Poll<Option<Result<hyper::body::Frame<Self::Data>, Self::Error>>> {
                            if !self.sent {
                                self.sent = true;
                                let data = std::mem::take(&mut self.data);
                                return std::task::Poll::Ready(Some(Ok(hyper::body::Frame::data(data))));
                            }
                            let mut trailers = http::HeaderMap::new();
                            trailers.insert("grpc-status", "0".parse().unwrap());
                            std::task::Poll::Ready(Some(Ok(hyper::body::Frame::trailers(trailers))))
                        }
                    }
                    // Cas NOT_FOUND : grpc-status est déjà dans les headers,
                    // body vide — garder un trailer aussi (grpc-status 12).
                    if builder
                        .headers_ref()
                        .and_then(|h| h.get("grpc-status"))
                        .map(|v| v == "12")
                        .unwrap_or(false)
                    {
                        return Ok::<_, std::convert::Infallible>(builder
                            .body(GrpcBody {
                                data: bytes::Bytes::new(),
                                sent: false,
                            })
                            .unwrap());
                    }
                    Ok(builder
                        .body(GrpcBody {
                            data: bytes::Bytes::from(body_bytes),
                            sent: false,
                        })
                        .unwrap())
                }
            });
            let _ = hyper::server::conn::http2::Builder::new(TestExecutor)
                .serve_connection(io, service)
                .await
                .inspect_err(|e| eprintln!("[test-server] connection error: {}", e));
        });
    }
}

enum ReflectionQuery {
    ListServices,
    Symbol(String),
}

/// Lit le champ posé par le client (3 = file_containing_symbol, 7 = list_services).
fn read_reflection_request_kind(buf: &[u8]) -> ReflectionQuery {
    let mut pos = 0;
    while pos < buf.len() {
        let mut key: u64 = 0;
        let mut shift = 0;
        while pos < buf.len() {
            let b = buf[pos];
            pos += 1;
            key |= ((b & 0x7f) as u64) << shift;
            if b & 0x80 == 0 { break; }
            shift += 7;
        }
        let field = (key >> 3) as u32;
        let wire = (key & 0x7) as u8;
        if wire == 2 {
            let mut len: u64 = 0;
            let mut s = 0;
            while pos < buf.len() {
                let b = buf[pos];
                pos += 1;
                len |= ((b & 0x7f) as u64) << s;
                if b & 0x80 == 0 { break; }
                s += 7;
            }
            let content = &buf[pos..(pos + len as usize).min(buf.len())];
            pos += len as usize;
            if field == 3 {
                return ReflectionQuery::Symbol(String::from_utf8_lossy(content).to_string());
            }
        } else if wire == 0 {
            let mut v: u64 = 0;
            let mut s = 0;
            while pos < buf.len() {
                let b = buf[pos];
                pos += 1;
                v |= ((b & 0x7f) as u64) << s;
                if b & 0x80 == 0 { break; }
                s += 7;
            }
            if field == 7 {
                return ReflectionQuery::ListServices;
            }
        }
    }
    ReflectionQuery::ListServices
}
use read_reflection_request_kind as read_reflection_symbol;

// ── Tests ───────────────────────────────────────────────────────────────────



#[tokio::test(flavor = "multi_thread")]
async fn lists_services_and_calls_echo_via_reflection() {
    let set = descriptor_set();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve_grpc_test_server(listener, set));

    let url = format!("http://{}", addr);
    let services = reqly_lib::grpc::__test::list_services(&url).await.unwrap();
    assert!(services.iter().any(|s| s.name == "reqly.test.Echo"), "services: {:?}", services);

    let echo = services.iter().find(|s| s.name == "reqly.test.Echo").unwrap();
    let say = echo.methods.iter().find(|m| m.name == "Say").unwrap();
    assert!(!say.server_streaming);
    assert_eq!(say.input_example, serde_json::json!({"text": ""}));

    let result = reqly_lib::grpc::__test::call(
        &url,
        "reqly.test.Echo/Say",
        r#"{"text": "hello reqly"}"#,
        &[],
    )
    .await
    .unwrap();
    assert_eq!(result.status, "ok");
    assert_eq!(result.grpc_status_code, "0");
    assert_eq!(result.responses[0], serde_json::json!({"text": "hello reqly"}));
}
