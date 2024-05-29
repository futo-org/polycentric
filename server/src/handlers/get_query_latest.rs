use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
    #[serde(
        deserialize_with = "crate::model::serde_url_deserialize_repeated_uint64"
    )]
    event_types: crate::protocol::RepeatedUInt64,
    limit: ::core::option::Option<u64>,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut client = crate::warp_try_err_500!(state.deadpool_write.get().await);

    let transaction = crate::warp_try_err_500!(client.transaction().await);

    let mut result = crate::protocol::Events::new();

    result.events = crate::warp_try_err_500!(
        crate::queries::select_latest::select(
            &transaction,
            &query.system,
            &query.event_types.numbers,
        )
        .await
    )
    .iter()
    .map(crate::model::signed_event::to_proto)
    .collect();

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
