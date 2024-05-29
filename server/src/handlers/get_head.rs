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
    Ok(crate::warp_try_err_500!(handler_inner(state, query).await))
}

async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    let mut transaction = state.pool_read_only.begin().await?;

    let mut client = state.deadpool_write.get().await?;

    let transaction = client.transaction().await?;

    let result_signed_events =
        crate::queries::select_head::select(&transaction, &query.system)
            .await?;

    transaction.commit().await?;

    let mut result = crate::protocol::Events::new();

    result.events = result_signed_events
        .iter()
        .map(crate::model::signed_event::to_proto)
        .collect();

    let result_serialized = result.write_to_bytes()?;

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
