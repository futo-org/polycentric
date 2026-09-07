//! Bearer JWT verification for incoming requests.

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;
use polycentric_common::jwt;
use polycentric_common::models::protos_v2::{KeyType, PublicKey};
use tonic::Status;

use crate::service::context::ServiceContext;
use crate::service::identity::service::cached_identity_content;

/// The verified identity of a request, available via request extensions.
#[derive(Debug, Clone)]
pub struct AuthenticatedIdentity(pub String);

/// The identity the request is authenticated as, or `None` when it
/// arrived without a verified auth token. Populated by [`auth_middleware`]
/// from the bearer JWT and carried through as a request extension.
pub fn authenticated_identity<T>(
    request: &tonic::Request<T>,
) -> Option<String> {
    request
        .extensions()
        .get::<AuthenticatedIdentity>()
        .map(|AuthenticatedIdentity(identity)| identity.clone())
}

#[derive(Clone)]
pub struct AuthState {
    pub ctx: std::sync::Arc<ServiceContext>,
    /// Accepted token audiences.
    pub allow_hosts: Vec<String>,
}

/// Verifies `authorization: Bearer <jwt>` headers and puts the identity in
/// the request extensions. No header means anonymous, a bad token is
/// rejected. A token we can't match against an identity document yet
/// (first sync, or a freshly paired key) passes through as anonymous.
pub async fn auth_middleware(
    State(state): State<AuthState>,
    mut request: Request,
    next: Next,
) -> Response {
    let token = request
        .headers()
        .get(http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));

    let mut authenticated = None;
    if let Some(token) = token {
        match verify_auth_token(&state.ctx, token, &state.allow_hosts).await {
            Ok(identity) => {
                let identity = AuthenticatedIdentity(identity);
                authenticated = Some(identity.clone());
                request.extensions_mut().insert(identity);
            }
            Err(status) if status.code() == tonic::Code::FailedPrecondition => {
                tracing::warn!(
                    reason = status.message(),
                    "auth token unverifiable"
                );
            }
            Err(status) => return grpc_error_response(status, &request),
        }
    }

    let mut response = next.run(request).await;
    // Expose the identity to the outer access-log middleware.
    if let Some(identity) = authenticated {
        response.extensions_mut().insert(identity);
    }
    response
}

/// Trailers-only gRPC error: HTTP 200 with grpc-status/grpc-message
/// headers. Echoes the request's content type so gRPC-Web clients accept
/// the response.
fn grpc_error_response(status: Status, request: &Request) -> Response {
    let content_type = request
        .headers()
        .get(http::header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| http::HeaderValue::from_static("application/grpc"));

    let mut response = Response::new(axum::body::Body::empty());
    let headers = response.headers_mut();
    headers.insert(http::header::CONTENT_TYPE, content_type);
    headers
        .insert("grpc-status", http::HeaderValue::from(status.code() as i32));
    if let Ok(message) = http::HeaderValue::from_str(status.message()) {
        headers.insert("grpc-message", message);
    }
    response
}

/// Verify `token` and return the identity it authenticates.
pub async fn verify_auth_token(
    ctx: &ServiceContext,
    token: &str,
    allow_hosts: &[String],
) -> Result<String, Status> {
    let unauthenticated =
        |e: jwt::JwtError| Status::unauthenticated(format!("Auth Token: {e}"));

    let verified = jwt::verify_jwt(token).map_err(unauthenticated)?;
    verified
        .validate(allow_hosts, now_secs())
        .map_err(unauthenticated)?;

    // The signing key must be in the issuer's identity document. Our copy
    // may be stale (pairing), so fail as a precondition, not a rejection.
    let signer = PublicKey {
        key_type: KeyType::Ed25519 as i32,
        key: verified.signed_by,
    };
    let identity_content = cached_identity_content(
        &ctx.ro_db,
        &ctx.proof_cache,
        &verified.claims.iss,
    )
    .await?;
    if !identity_content.authorizes_signer(&signer) {
        return Err(Status::failed_precondition(
            "auth token: signing key is not authorized by the issuer's identity document here",
        ));
    }

    Ok(verified.claims.iss)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::verifications::rpc::common::tests::{ctx, no_rows};
    use axum::Router;
    use axum::body::Body;
    use axum::routing::any;
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use ed25519_dalek::{Signer, SigningKey};
    use sea_orm::{DatabaseConnection, DbBackend, MockDatabase};
    use tower::ServiceExt;

    const AUD: &str = "https://this.server";

    /// Router that echoes who the request is authenticated as.
    async fn app(db: DatabaseConnection) -> Router {
        let state = AuthState {
            ctx: ctx(db).await,
            allow_hosts: vec![AUD.to_string()],
        };
        Router::new()
            .route(
                "/",
                any(|request: Request| async move {
                    match request.extensions().get::<AuthenticatedIdentity>() {
                        Some(AuthenticatedIdentity(identity)) => {
                            identity.clone()
                        }
                        None => "anonymous".to_string(),
                    }
                }),
            )
            .layer(axum::middleware::from_fn_with_state(state, auth_middleware))
    }

    /// Mint a token matching js-core's `createServerJwt` format.
    fn mint(iss: &str, aud: &str) -> String {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let kid: String = hex::encode(key.verifying_key().to_bytes());
        let exp = now_secs() + 3600;
        let header = format!(r#"{{"alg":"EdDSA","typ":"JWT","kid":"{kid}"}}"#);
        let claims =
            format!(r#"{{"iss":"{iss}","aud":"{aud}","iat":0,"exp":{exp}}}"#);
        let signing_input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(header),
            URL_SAFE_NO_PAD.encode(claims)
        );
        let signature = key.sign(signing_input.as_bytes());
        format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        )
    }

    const GRPC_WEB: &str = "application/grpc-web+proto";

    fn request(bearer: Option<&str>) -> Request {
        let mut builder = http::Request::builder()
            .uri("/")
            .header("content-type", GRPC_WEB);
        if let Some(token) = bearer {
            builder =
                builder.header("authorization", format!("Bearer {token}"));
        }
        builder.body(Body::empty()).unwrap()
    }

    async fn body_of(response: Response) -> String {
        let bytes = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn requests_without_a_token_pass_through_unauthenticated() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let response = app(db).await.oneshot(request(None)).await.unwrap();

        assert_eq!(body_of(response).await, "anonymous");
    }

    #[tokio::test]
    async fn a_garbage_token_is_rejected_as_a_grpc_error() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let response = app(db)
            .await
            .oneshot(request(Some("garbage")))
            .await
            .unwrap();

        assert_eq!(
            response.headers().get("grpc-status").unwrap(),
            &http::HeaderValue::from(Status::unauthenticated("").code() as i32)
        );
        assert_eq!(response.headers().get("content-type").unwrap(), GRPC_WEB);
    }

    #[tokio::test]
    async fn a_token_for_another_audience_is_rejected() {
        let db = MockDatabase::new(DbBackend::Postgres).into_connection();
        let response = app(db)
            .await
            .oneshot(request(Some(&mint("someone", "https://other.server"))))
            .await
            .unwrap();

        assert!(response.headers().get("grpc-status").is_some());
    }

    #[tokio::test]
    async fn a_valid_token_for_an_unknown_issuer_falls_through_unauthenticated()
    {
        // No identity document stored for the issuer.
        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([no_rows()])
            .into_connection();
        let response = app(db)
            .await
            .oneshot(request(Some(&mint("someone", AUD))))
            .await
            .unwrap();

        assert_eq!(body_of(response).await, "anonymous");
    }

    #[tokio::test]
    async fn a_signer_the_stored_identity_does_not_authorize_falls_through_unauthenticated()
     {
        use crate::service::proto::content::ContentBody;
        use crate::service::proto::{Content, Identity};
        use ::entity::{content_model, event_model};
        use chrono::DateTime;
        use polycentric_common::models::collections;
        use prost::Message;

        // Identity document that doesn't know the minting key yet, as
        // during pairing.
        let identity_content = Identity {
            rotation_keys: vec![
                polycentric_common::models::protos_v2::PublicKey {
                    key_type: KeyType::Ed25519 as i32,
                    key: vec![0xbb; 32],
                },
            ],
            ..Default::default()
        };
        let iss = identity_content.derive_hex_key();
        let content = Content {
            content_body: Some(ContentBody::Identity(identity_content)),
        };

        let now = DateTime::from_timestamp_secs(1).unwrap().fixed_offset();
        let event = event_model::Model {
            id: 1,
            collection: collections::IDENTITY as i16,
            identity: iss.clone(),
            public_key_type: KeyType::Ed25519 as i32 as i16,
            public_key: vec![0xbb; 32],
            sequence: 1,
            content_digest_type: Some(1),
            content_digest_bytes: Some(vec![1]),
            signature: vec![1],
            previous_signature: vec![],
            previous_root: vec![],
            application_id: None,
            event_bytes: vec![1],
            created_at: now,
            synced_at: now,
        };
        let content_row = content_model::Model {
            id: 1,
            digest_type: 1,
            digest_bytes: vec![1],
            serialized_bytes: content.encode_to_vec(),
            synced_at: now,
        };

        let db = MockDatabase::new(DbBackend::Postgres)
            .append_query_results([vec![(event, content_row)]])
            .into_connection();
        let response = app(db)
            .await
            .oneshot(request(Some(&mint(&iss, AUD))))
            .await
            .unwrap();

        assert_eq!(body_of(response).await, "anonymous");
    }
}
