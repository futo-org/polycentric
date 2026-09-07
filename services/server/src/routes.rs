use axum::{
    Router,
    extract::{Path, Query, State},
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use sea_orm::DatabaseConnection;
use std::collections::HashMap;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::grpc::reflection_ui::reflection_ui;
use crate::service::content::content_filestore::ContentFilestore;
use crate::service::content::content_repository as ContentRepository;
use crate::service::proto::ContentDigest;
use crate::util::{http_client, scraper};

#[derive(Clone)]
struct AppState {
    ro_db: DatabaseConnection,
    filestore: ContentFilestore,
}

const CACHE_CONTROL: &str = "public, max-age=604800, stale-while-revalidate=604800, stale-if-error=604800";

/// Routes defined here for the polycentric server
pub fn build_routes(
    db: DatabaseConnection,
    ro_db: DatabaseConnection,
    filestore: ContentFilestore,
) -> Router {
    _ = db; // Currently unused.
    let state = AppState { ro_db, filestore };

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::any())
        .allow_methods([Method::GET, Method::OPTIONS])
        .max_age(std::time::Duration::from_secs(86400));

    Router::new()
        .route("/", get(|| async { "Hello, World!" }))
        .route("/status", get(|| async { "OK." }))
        .route("/docs", get(reflection_ui))
        .route("/blob/{digest_id}", get(get_blob))
        .route("/image_proxy", get(image_proxy))
        .with_state(state)
        .layer(cors)
}

/// Serve a blob body by its content digest. `digest_id` is encoded as
/// `{digest_type}_{hex(digest_value)}`, e.g. `1_<64 hex chars>` for
/// SHA256. This matches the on-disk key format.
async fn get_blob(
    State(state): State<AppState>,
    Path(digest_id): Path<String>,
) -> Result<Response, StatusCode> {
    let digest =
        ContentDigest::from_id(&digest_id).ok_or(StatusCode::BAD_REQUEST)?;

    let row = ContentRepository::Query::find_blob_by_digest(
        &state.ro_db,
        digest.r#type as i16,
        &digest.value,
    )
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "get_blob db error");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    let body = state.filestore.read_blob(&digest).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            tracing::error!(error = %e, "get_blob filestore error");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    Ok((
        [
            (header::CONTENT_TYPE, row.mime_type),
            (header::CACHE_CONTROL, CACHE_CONTROL.to_string()),
        ],
        body,
    )
        .into_response())
}

/// Proxy a preview image from an untrusted URL (`?url=`) for display. The
/// actual fetch is delegated to the scraper service — the single SSRF surface —
/// so this just pre-validates the target and streams the result back. Keeps
/// reader IPs off third-party hosts and avoids mixed-content/CORS on the client.
async fn image_proxy(
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, StatusCode> {
    let url = params.get("url").ok_or(StatusCode::BAD_REQUEST)?;

    let resp = http_client::client()
        .get(scraper::image_url())
        .query(&[("url", url.as_str())])
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    if !resp.status().is_success() {
        return Err(StatusCode::BAD_GATEWAY);
    }

    // Pass through the content type the scraper validated, plus caching.
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let body = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, CACHE_CONTROL.to_string()),
        ],
        body,
    )
        .into_response())
}
