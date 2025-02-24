use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "polycentric_protocol::model::public_key::serde_url_deserialize"
    )]
    system: polycentric_protocol::model::public_key::PublicKey,
    content_type: u64,
    after: ::core::option::Option<u64>,
    limit: ::core::option::Option<u64>,
    #[serde(
        default,
        deserialize_with = "crate::handlers::util::deserialize_json_string"
    )]
    moderation_filters: Option<crate::moderation::ModerationFilters>,
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
            &crate::moderation::ModerationOptions {
                filters: query.moderation_filters,
                mode: state.moderation_mode,
            },
        )
        .await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    let mut result = polycentric_protocol::protocol::QueryIndexResponse::new();

    result.events = query_result
        .events
        .iter()
        .map(polycentric_protocol::model::signed_event::to_proto)
        .collect();

    result.proof = query_result
        .proof
        .iter()
        .map(polycentric_protocol::model::signed_event::to_proto)
        .collect();

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, s-maxage=3600, max-age=5",
    )))
}
