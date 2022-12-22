use ::protobuf::Message;

fn decode_query_request_event_ranges<'de, D>(
    deserializer: D,
) -> Result<crate::protocol::RequestEventRanges, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    crate::protocol::RequestEventRanges::parse_from_tokio_bytes(
        &::bytes::Bytes::from(bytes),
    )
    .map_err(::serde::de::Error::custom)
}

#[derive(::serde::Deserialize)]
pub(crate) struct RequestEventRangesQuery {
    #[serde(deserialize_with = "decode_query_request_event_ranges")]
    query: crate::protocol::RequestEventRanges,
}

pub(crate) async fn handler(
    query: RequestEventRangesQuery,
    state: ::std::sync::Arc<crate::State>,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    let request = query.query;

    let identity =
        ::ed25519_dalek::PublicKey::from_bytes(&request.author_public_key)
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;

    let writer = crate::model::vec_to_writer_id(&request.writer_id)
        .map_err(|e| crate::RequestError::Anyhow(e))?;

    let mut transaction =
        state.pool.begin().await.map_err(|e| {
            crate::RequestError::Anyhow(::anyhow::Error::new(e))
        })?;

    let mut history: ::std::vec::Vec<crate::postgres::store_item::StoreItem> =
        vec![];

    for range in &request.ranges {
        let mut rows = crate::postgres::load_range(
            &mut transaction,
            &identity,
            &writer,
            range.low,
            range.high,
        )
        .await
        .map_err(|e| crate::RequestError::Anyhow(e))?;

        history.append(&mut rows);
    }

    let mut result = crate::protocol::Events::new();

    let mut processed_events =
        crate::process_mutations2(&mut transaction, history)
            .await
            .map_err(|e| crate::RequestError::Anyhow(e))?;

    result.events.append(&mut processed_events.related_events);
    result.events.append(&mut processed_events.result_events);

    transaction
        .commit()
        .await
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let result_serialized = result
        .write_to_bytes()
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    Ok(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    ))
}
