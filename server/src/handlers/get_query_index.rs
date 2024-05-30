use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
    content_type: u64,
    after: ::core::option::Option<u64>,
    limit: ::core::option::Option<u64>,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let query_result = crate::warp_try_err_500!(
        crate::postgres::query_index::query_index(
            &mut transaction,
            &query.system,
            query.content_type,
            query.limit.unwrap_or(10),
            &query.after,
        )
        .await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    let mut result = crate::protocol::QueryIndexResponse::new();

    result.events = query_result
        .events
        .iter()
        .map(crate::model::signed_event::to_proto)
        .collect();

    result.proof = query_result
        .proof
        .iter()
        .map(crate::model::signed_event::to_proto)
        .collect();

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
