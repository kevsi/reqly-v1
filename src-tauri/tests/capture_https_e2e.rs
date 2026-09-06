//! Test d'intégration bout-en-bout de l'interception HTTPS :
//! CONNECT → TLS (certificat forgé) → requête capturée → réponse amont.
//!
//! Ce test vit dans un binaire d'intégration séparé : le vérifieur client
//! rustls `dangerous()` fait échouer le CHARGEMENT du binaire de tests
//! unitaires sur certains postes Windows (STATUS_ENTRYPOINT_NOT_FOUND au
//! chargement d'une DLL dépendante) — hors binaire principal, ce code ne
//! doit pas être compilé avec les tests unitaires.

use reqly_lib::capture::{CaptureProxyState, ManagedCaptureProxyState};
use reqly_lib::capture_https::{start_https_proxy, CaptureEmitter, LocalCa};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;

/// Vérifieur client qui accepte tout (le test valide le flux complet, pas
/// la confiance TLS — la CA de test est fraîche et non installée).
#[derive(Debug)]
struct NoVerify;

impl ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ED25519,
        ]
    }
}

#[tokio::test]
async fn intercepts_connect_tunnel_end_to_end() {
    let _ = rustls::crypto::ring::default_provider().install_default();

    // ── Amont : serveur TLS auto-signé qui répond 200 "hello-upstream" ──
    let upstream_ca_dir = tempfile::tempdir().unwrap();
    let upstream_ca = LocalCa::load_or_create(&upstream_ca_dir.path().to_path_buf()).unwrap();
    let upstream_leaf = upstream_ca.leaf_for("127.0.0.1").unwrap();
    let upstream_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![upstream_leaf.cert_der.clone()],
            rustls::pki_types::PrivateKeyDer::Pkcs8(upstream_leaf.key_der.clone_key()),
        )
        .unwrap();
    let upstream_acceptor = Arc::new(TlsAcceptor::from(Arc::new(upstream_config)));
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_port = upstream_listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        loop {
            let Ok((sock, _)) = upstream_listener.accept().await else { continue };
            let acceptor = upstream_acceptor.clone();
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(sock).await else { return };
                let mut buf = vec![0u8; 4096];
                let _ = tls.read(&mut buf).await;
                let body = "hello-upstream";
                let _ = tls
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}",
                            body.len(),
                            body
                        )
                        .as_bytes(),
                    )
                    .await;
                let _ = tls.flush().await;
            });
        }
    });

    // ── Le proxy d'interception ──
    let ca_dir_tmp = tempfile::tempdir().unwrap();
    let ca = LocalCa::load_or_create(&ca_dir_tmp.path().to_path_buf()).unwrap();
    let capture_state: ManagedCaptureProxyState =
        Arc::new(Mutex::new(CaptureProxyState::default()));
    let upstream_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap();
    // start_https_proxy crée son propre runtime tokio : l'appeler hors du
    // runtime du test (comme le fait la commande Tauri, synchrone).
    let capture_state_for_proxy = capture_state.clone();
    let proxy = tokio::task::spawn_blocking(move || {
        start_https_proxy(
            CaptureEmitter::Silent,
            0,
            capture_state_for_proxy,
            ca,
            upstream_client,
        )
    })
    .await
    .unwrap()
    .unwrap();
    let proxy_port = proxy.addr.port();

    // ── Client : CONNECT puis TLS puis requête ──
    let mut client = TcpStream::connect(("127.0.0.1", proxy_port)).await.unwrap();
    client
        .write_all(
            format!(
                "CONNECT 127.0.0.1:{} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
                upstream_port, upstream_port
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let mut ack = vec![0u8; 256];
    let n = client.read(&mut ack).await.unwrap();
    let ack_str = String::from_utf8_lossy(&ack[..n]).to_string();
    assert!(ack_str.starts_with("HTTP/1.1 200"), "got: {}", ack_str);

    // TLS client (tout certificat accepté) sur le tunnel.
    let client_config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoVerify))
        .with_no_client_auth();
    let connector = tokio_rustls::TlsConnector::from(Arc::new(client_config));
    let mut tls = connector
        .connect(
            ServerName::try_from("127.0.0.1".to_string()).unwrap(),
            client,
        )
        .await
        .expect("client tls handshake");

    let request = format!(
        "GET /test HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        upstream_port
    );
    tls.write_all(request.as_bytes()).await.unwrap();
    tls.flush().await.unwrap();
    let mut response = Vec::new();
    let _ =
        tokio::time::timeout(std::time::Duration::from_secs(5), tls.read_to_end(&mut response))
            .await;
    let response_str = String::from_utf8_lossy(&response).to_string();
    assert!(
        response_str.contains("hello-upstream"),
        "réponse sans le corps amont : {:?}",
        response_str
    );

    // ── La requête a été capturée ──
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let captured = capture_state.lock().unwrap().captured.clone();
    assert_eq!(captured.len(), 1, "une requête capturée attendue");
    assert_eq!(captured[0].method, "GET");
    assert!(captured[0].url.contains("/test"));
    assert_eq!(captured[0].status, Some(200));
    assert!(captured[0]
        .response_body
        .as_deref()
        .unwrap_or("")
        .contains("hello-upstream"));
}
