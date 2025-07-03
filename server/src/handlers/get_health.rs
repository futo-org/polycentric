use ::warp::reply::Response;
use ::warp::{http::StatusCode, Reply};

/// Health endpoint that checks database and OpenSearch connectivity.
/// Returns 200 if all subsystems are healthy, otherwise 503.
pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
) -> Result<Response, ::std::convert::Infallible> {
    use ::serde_json::json;
    use ::tokio::time::{timeout, Duration};

    // DB check: simple `SELECT 1` with 2-second timeout
    let db_ok = timeout(Duration::from_secs(2), async {
        ::sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(&state.pool)
            .await
            .is_ok()
    })
    .await
    .unwrap_or(false);

    // OpenSearch check: query index exists (messages) – 2-second timeout
    let os_ok = timeout(Duration::from_secs(2), async {
        use opensearch::indices::IndicesExistsParts;
        state
            .search
            .indices()
            .exists(IndicesExistsParts::Index(&["messages"]))
            .send()
            .await
            .map(|resp| resp.status_code().is_success())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false);

    // Combine results
    let overall_ok = db_ok && os_ok;

    let body = json!({
        "db": db_ok,
        "opensearch": os_ok,
        "status": if overall_ok { "ok" } else { "degraded" }
    });

    let status = if overall_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    Ok(
        ::warp::reply::with_status(::warp::reply::json(&body), status)
            .into_response(),
    )
}
