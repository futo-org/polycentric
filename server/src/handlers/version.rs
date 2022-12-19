pub (crate) async fn handler()
-> Result<impl ::warp::Reply, ::warp::Rejection> {
    Ok(::warp::reply::json(&::serde_json::json!({
        "sha": crate::version::VERSION,
    })))
}

