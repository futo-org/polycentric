use axum::http::StatusCode;

mod common;
use common::{AuthHelper, AxumTestHelper, TestIdentity, TestSetup};
use dm_server::handlers::auth;

#[tokio::test]
async fn test_get_challenge() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let router = setup.create_test_router();

    // Test getting a challenge
    let (status, body) = AxumTestHelper::get(&router, "/challenge", None).await;

    assert_eq!(status, StatusCode::OK);

    let response: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(response.get("body").is_some());
    assert!(response.get("hmac").is_some());

    // Verify challenge structure
    let challenge_body_bytes = response.get("body").unwrap().as_array().unwrap();
    let challenge_body: serde_json::Value = serde_json::from_slice(
        &challenge_body_bytes
            .iter()
            .map(|v| v.as_u64().unwrap() as u8)
            .collect::<Vec<u8>>(),
    )
    .unwrap();

    assert!(challenge_body.get("challenge").is_some());
    assert!(challenge_body.get("created_on").is_some());
}

#[tokio::test]
async fn test_valid_authentication() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();

    // Test challenge generation and verification
    let challenge_body = serde_json::json!({
        "challenge": vec![1u8; 32],
        "created_on": chrono::Utc::now().timestamp_millis() as u64
    });

    let body_bytes = serde_json::to_vec(&challenge_body).unwrap();
    let hmac =
        hmac_sha256::HMAC::mac(body_bytes.clone(), setup.config.challenge_key.as_bytes()).to_vec();

    let challenge_response = dm_server::handlers::auth::ChallengeResponse {
        body: body_bytes,
        hmac,
    };

    let signature = identity.sign_data(&vec![1u8; 32]);

    let auth_request = dm_server::handlers::auth::AuthRequest {
        challenge_response,
        identity: identity.polycentric_identity.clone(),
        signature,
    };

    // Test verification
    let result = auth::verify_auth(&auth_request, &setup.config.challenge_key);
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_invalid_hmac() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();

    let challenge_body = serde_json::json!({
        "challenge": vec![1u8; 32],
        "created_on": chrono::Utc::now().timestamp_millis() as u64
    });

    let body_bytes = serde_json::to_vec(&challenge_body).unwrap();
    let wrong_hmac = vec![0u8; 32]; // Wrong HMAC

    let challenge_response = dm_server::handlers::auth::ChallengeResponse {
        body: body_bytes,
        hmac: wrong_hmac,
    };

    let signature = identity.sign_data(&vec![1u8; 32]);

    let auth_request = dm_server::handlers::auth::AuthRequest {
        challenge_response,
        identity: identity.polycentric_identity.clone(),
        signature,
    };

    // Test verification should fail
    let result = auth::verify_auth(&auth_request, &setup.config.challenge_key);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Invalid HMAC"));
}

#[tokio::test]
async fn test_expired_challenge() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();

    // Create expired challenge (10 minutes ago)
    let challenge_body = serde_json::json!({
        "challenge": vec![1u8; 32],
        "created_on": (chrono::Utc::now().timestamp_millis() - 600_000) as u64
    });

    let body_bytes = serde_json::to_vec(&challenge_body).unwrap();
    let hmac =
        hmac_sha256::HMAC::mac(body_bytes.clone(), setup.config.challenge_key.as_bytes()).to_vec();

    let challenge_response = dm_server::handlers::auth::ChallengeResponse {
        body: body_bytes,
        hmac,
    };

    let signature = identity.sign_data(&vec![1u8; 32]);

    let auth_request = dm_server::handlers::auth::AuthRequest {
        challenge_response,
        identity: identity.polycentric_identity.clone(),
        signature,
    };

    // Test verification should fail
    let result = auth::verify_auth(&auth_request, &setup.config.challenge_key);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("Challenge expired"));
}

#[tokio::test]
async fn test_invalid_signature() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();

    let challenge_body = serde_json::json!({
        "challenge": vec![1u8; 32],
        "created_on": chrono::Utc::now().timestamp_millis() as u64
    });

    let body_bytes = serde_json::to_vec(&challenge_body).unwrap();
    let hmac =
        hmac_sha256::HMAC::mac(body_bytes.clone(), setup.config.challenge_key.as_bytes()).to_vec();

    let challenge_response = dm_server::handlers::auth::ChallengeResponse {
        body: body_bytes,
        hmac,
    };

    let wrong_signature = vec![0u8; 64]; // Wrong signature

    let auth_request = dm_server::handlers::auth::AuthRequest {
        challenge_response,
        identity: identity.polycentric_identity.clone(),
        signature: wrong_signature,
    };

    // Test verification should fail
    let result = auth::verify_auth(&auth_request, &setup.config.challenge_key);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("Signature verification failed"));
}

#[tokio::test]
async fn test_auth_header_extraction() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    let identity = TestIdentity::new();
    let auth_header = AuthHelper::create_auth_header(&identity, &setup.config.challenge_key).await;

    let result = auth::extract_auth_identity(&auth_header, &setup.config.challenge_key);
    assert!(result.is_ok());

    let extracted_identity = result.unwrap();
    assert_eq!(
        extracted_identity.key_type,
        identity.polycentric_identity.key_type
    );
    assert_eq!(
        extracted_identity.key_bytes,
        identity.polycentric_identity.key_bytes
    );
}

#[tokio::test]
async fn test_invalid_auth_header_format() {
    let setup = TestSetup::new().await;
    setup.cleanup().await;

    // Test invalid header format
    let result = auth::extract_auth_identity("Invalid format", &setup.config.challenge_key);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("Invalid authorization header format"));

    // Test invalid base64
    let result = auth::extract_auth_identity("Bearer invalid-base64!", &setup.config.challenge_key);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("Invalid base64 encoding"));
}
