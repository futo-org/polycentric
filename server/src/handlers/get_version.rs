use ::warp::Reply;

pub(crate) async fn handler() -> ::warp::reply::Response {
    ::warp::reply::json(&::serde_json::json!({
        "sha": crate::version::VERSION,
    }))
    .into_response()
}
