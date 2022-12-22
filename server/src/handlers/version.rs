pub(crate) async fn handler()
    -> Result<impl ::warp::Reply, ::std::convert::Infallible>
{
    Ok(::warp::reply::json(&::serde_json::json!({
        "sha": crate::version::VERSION,
    })))
}
