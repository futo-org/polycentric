use axum::{
    body::Body,
    http::{Request, StatusCode},
    routing::{get, post},
    Router,
};
use base64;
use ed25519_dalek::{SigningKey, VerifyingKey};
use http_body_util::BodyExt;
use rand::rngs::OsRng;
use serde_json;
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

use dm_server::{
    config::Config,
    crypto::DMCrypto,
    db::DatabaseManager,
    handlers::{
        auth,
        auth::{AuthRequest, ChallengeBody, ChallengeResponse},
        dm, keys, AppState,
    },
    models::PolycentricIdentity,
};

/// Test utilities and common setup
pub struct TestSetup {
    pub db: Arc<DatabaseManager>,
    pub config: Arc<Config>,
    pub app_state: AppState,
    pub pool: PgPool,
}

impl TestSetup {
    pub async fn new() -> Self {
        // Use test database
        let database_url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
            "postgresql://postgres:password@localhost:5432/dm_server_test".to_string()
        });

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(50) // Increased for concurrent tests
            .min_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(30))
            .idle_timeout(Some(std::time::Duration::from_secs(60)))
            .connect(&database_url)
            .await
            .expect("Failed to connect to test database");

        // Run migrations
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("Failed to run migrations");

        let config = Arc::new(Config {
            database_url,
            server_port: 0,                                       // Test port
            websocket_port: 0,                                    // Test port
            challenge_key: "change-me-in-production".to_string(), // Use same as default CONFIG
            max_message_size: 1024 * 1024,
            message_retention_days: 30,
            max_connections_per_user: 5,
            cleanup_interval_seconds: 3600,
            ping_interval_seconds: 30,
            connection_timeout_seconds: 300,
            log_level: "debug".to_string(),
        });

        let db = Arc::new(DatabaseManager::new(pool.clone()));

        let app_state = AppState { db: db.clone() };

        Self {
            db,
            config,
            app_state,
            pool,
        }
    }

    /// Clean up the database between tests
    pub async fn cleanup(&self) {
        let _ = sqlx::query(
            "TRUNCATE TABLE dm_messages, user_x25519_keys, active_connections, message_delivery",
        )
        .execute(&self.pool)
        .await;
    }

    /// Create a test router for Axum testing
    pub fn create_test_router(&self) -> Router {
        use axum::http::Method;
        use tower_http::cors::{Any, CorsLayer};

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
            ])
            .allow_methods([Method::GET, Method::POST]);

        Router::new()
            .route("/health", get(health_handler))
            .route("/challenge", get(auth::get_challenge))
            .route("/register_key", post(keys::register_x25519_key))
            .route("/get_key", post(keys::get_x25519_key))
            .route("/send", post(dm::send_dm))
            .route("/history", post(dm::get_dm_history))
            .route("/conversations", get(keys::get_conversations))
            .route("/mark_read", post(dm::mark_messages_read))
            .layer(cors)
            .with_state(self.app_state.clone())
    }
}

async fn health_handler() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({"status": "ok"}))
}

/// Test identity for creating test users
pub struct TestIdentity {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
    pub polycentric_identity: PolycentricIdentity,
    pub x25519_private_key: Vec<u8>,
    pub x25519_public_key: Vec<u8>,
}

impl TestIdentity {
    pub fn new() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        let polycentric_identity = PolycentricIdentity::new(
            1, // Ed25519 key type
            verifying_key.to_bytes().to_vec(),
        );

        // Generate X25519 keypair
        let (x25519_secret, x25519_public) = DMCrypto::generate_x25519_keypair();
        let x25519_private_key = DMCrypto::x25519_secret_to_bytes(&x25519_secret).to_vec();
        let x25519_public_key = x25519_public.to_bytes().to_vec();

        Self {
            signing_key,
            verifying_key,
            polycentric_identity,
            x25519_private_key,
            x25519_public_key,
        }
    }

    /// Sign data with this identity's private key
    pub fn sign_data(&self, data: &[u8]) -> Vec<u8> {
        DMCrypto::sign_data(&self.signing_key, data)
    }

    /// Register X25519 key (returns signature)
    pub fn sign_x25519_key(&self) -> Vec<u8> {
        self.sign_data(&self.x25519_public_key)
    }
}

/// Helper for creating authentication headers
pub struct AuthHelper;

impl AuthHelper {
    pub async fn create_auth_header(identity: &TestIdentity, challenge_key: &str) -> String {
        // Generate a fresh challenge
        let challenge = DMCrypto::generate_challenge();
        let created_on = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Create challenge body using proper struct
        let challenge_body = ChallengeBody {
            challenge: challenge.to_vec(),
            created_on,
        };

        // Serialize and create HMAC
        let body_bytes = serde_json::to_vec(&challenge_body).unwrap();
        let hmac = hmac_sha256::HMAC::mac(body_bytes.clone(), challenge_key.as_bytes()).to_vec();

        // Create challenge response using proper struct
        let challenge_response = ChallengeResponse {
            body: body_bytes,
            hmac,
        };

        // Sign the challenge with the identity's private key
        let signature = identity.sign_data(&challenge);

        // Create the complete auth request using proper struct
        let auth_request = AuthRequest {
            challenge_response,
            identity: identity.polycentric_identity.clone(),
            signature,
        };

        // Encode to base64 for the Authorization header
        let auth_bytes = serde_json::to_vec(&auth_request).unwrap();
        let auth_b64 = base64::encode(&auth_bytes);

        // Debug: Print the generated auth header (first 100 chars)
        let header = format!("Bearer {}", auth_b64);
        println!(
            "Generated auth header (first 100 chars): {}",
            &header[..std::cmp::min(100, header.len())]
        );
        println!(
            "Challenge length: {}, Auth request serialized length: {}",
            challenge.len(),
            auth_bytes.len()
        );

        header
    }
}

/// Message creation helpers
pub struct MessageHelper;

impl MessageHelper {
    pub fn create_test_message(
        sender: &TestIdentity,
        recipient: &TestIdentity,
        content: &str,
    ) -> (String, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
        let message_id = format!("test_msg_{}", Uuid::new_v4());

        // Generate ephemeral keypair
        let (ephemeral_secret, ephemeral_public) = DMCrypto::generate_ephemeral_keypair();
        let ephemeral_public_bytes = ephemeral_public.to_bytes().to_vec();

        // Encrypt message
        let content_bytes = content.as_bytes();
        let recipient_x25519_key =
            DMCrypto::x25519_public_from_bytes(&recipient.x25519_public_key).unwrap();

        let (encrypted, nonce) = DMCrypto::encrypt_message(
            content_bytes,
            ephemeral_secret,
            &recipient_x25519_key,
            dm_server::crypto::EncryptionAlgorithm::ChaCha20Poly1305,
        )
        .unwrap();

        // Create message for signing using the same format as the handler
        // Format: [message_id_bytes][sender_key_type][sender_key_bytes][recipient_key_type][recipient_key_bytes][ephemeral_key][encrypted_content][nonce]
        let message_id_bytes = message_id.as_bytes();
        let mut message_data = Vec::new();

        // Add message_id bytes
        message_data.extend_from_slice(message_id_bytes);

        // Add sender key_type (u64, little-endian)
        message_data.extend_from_slice(&sender.polycentric_identity.key_type.to_le_bytes());

        // Add sender key_bytes
        message_data.extend_from_slice(&sender.polycentric_identity.key_bytes);

        // Add recipient key_type (u64, little-endian)
        message_data.extend_from_slice(&recipient.polycentric_identity.key_type.to_le_bytes());

        // Add recipient key_bytes
        message_data.extend_from_slice(&recipient.polycentric_identity.key_bytes);

        // Add ephemeral public key
        message_data.extend_from_slice(&ephemeral_public_bytes);

        // Add encrypted content
        message_data.extend_from_slice(&encrypted);

        // Add nonce
        message_data.extend_from_slice(&nonce);

        let signature = sender.sign_data(&message_data);

        (
            message_id,
            ephemeral_public_bytes,
            encrypted,
            nonce,
            signature,
        )
    }

    pub fn decrypt_test_message(
        recipient: &TestIdentity,
        ephemeral_public_key: &[u8],
        encrypted_content: &[u8],
        nonce: &[u8],
    ) -> Result<String, anyhow::Error> {
        let recipient_secret = DMCrypto::x25519_secret_from_bytes(&recipient.x25519_private_key)?;
        let ephemeral_public = DMCrypto::x25519_public_from_bytes(ephemeral_public_key)?;

        let decrypted = DMCrypto::decrypt_message(
            encrypted_content,
            nonce,
            &recipient_secret,
            &ephemeral_public,
            dm_server::crypto::EncryptionAlgorithm::ChaCha20Poly1305,
        )?;

        Ok(String::from_utf8(decrypted)?)
    }
}

/// Helper functions for Axum testing
pub struct AxumTestHelper;

impl AxumTestHelper {
    /// Make a GET request
    pub async fn get(
        router: &Router,
        path: &str,
        auth_header: Option<&str>,
    ) -> (StatusCode, String) {
        let mut request = Request::builder()
            .method("GET")
            .uri(path)
            .header("content-type", "application/json");

        if let Some(auth) = auth_header {
            request = request.header("authorization", auth);
        }

        let request = request.body(Body::empty()).unwrap();
        let response = router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        (status, body_str)
    }

    /// Make a POST request
    pub async fn post(
        router: &Router,
        path: &str,
        body: &str,
        auth_header: Option<&str>,
    ) -> (StatusCode, String) {
        let mut request = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json");

        if let Some(auth) = auth_header {
            request = request.header("authorization", auth);
        }

        let request = request.body(Body::from(body.to_string())).unwrap();
        let response = router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        (status, body_str)
    }

    /// Make a GET request with query parameters
    pub async fn get_with_query(
        router: &Router,
        path: &str,
        query: &str,
        auth_header: Option<&str>,
    ) -> (StatusCode, String) {
        let full_path = if query.is_empty() {
            path.to_string()
        } else {
            format!("{}?{}", path, query)
        };

        Self::get(router, &full_path, auth_header).await
    }
}
