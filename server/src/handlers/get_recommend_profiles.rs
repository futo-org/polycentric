use ::protobuf::Message;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut result = crate::protocol::PublicKeys::new();

    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let random_identities = crate::warp_try_err_500!(
        crate::postgres::load_random_profiles(&mut transaction).await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    for identity in random_identities.iter() {
        result
            .systems
            .push(crate::model::public_key::to_proto(identity));
    }

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
