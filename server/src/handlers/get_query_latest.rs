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
    event_types: polycentric_protocol::protocol::RepeatedUInt64,
}

async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    let mut result = polycentric_protocol::protocol::Events::new();

    let mut transaction = state.pool_read_only.begin().await?;

    result.events = crate::postgres::select_latest_by_content_type::select(
        &mut transaction,
        &query.system,
        &query.event_types.numbers,
    )
    .await?
    .iter()
    .map(crate::model::signed_event::to_proto)
    .collect();

    transaction.commit().await?;

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result.write_to_bytes()?,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    Ok(crate::warp_try_err_500!(handler_inner(state, query).await))
}
