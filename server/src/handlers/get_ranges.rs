use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut client =
        crate::warp_try_err_500!(state.deadpool_write.get().await);

    let transaction = crate::warp_try_err_500!(client.transaction().await);

    let result = crate::warp_try_err_500!(
        crate::queries::select_ranges_for_system::select(
            &transaction,
            &query.system,
        )
        .await
    );

    crate::warp_try_err_500!(transaction.commit().await);

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
