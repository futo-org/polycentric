use ::protobuf::Message;

pub(crate) async fn handler(
    _state: ::std::sync::Arc<crate::State>,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let result = crate::protocol::ResultEventsAndRelatedEventsAndCursor::new();

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
