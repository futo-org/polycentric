use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    handle: String,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let handle: String = query.handle.clone();

    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let identity = crate::warp_try_err_500!(
        crate::postgres::resolve_handle(&mut transaction, handle).await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    let result = polycentric_protocol::model::public_key::to_proto(&identity);
    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    Ok(Box::new(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    )))
}
