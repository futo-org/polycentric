use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct RequestKnownRangesForFeedQuery {
    #[serde(deserialize_with = "decode_query_known_ranges_for_feed")]
    query: crate::protocol::RequestKnownRangesForFeed,
}

fn decode_query_known_ranges_for_feed<'de, D>(
    deserializer: D,
) -> Result<crate::protocol::RequestKnownRangesForFeed, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    crate::protocol::RequestKnownRangesForFeed::parse_from_tokio_bytes(
        &::bytes::Bytes::from(bytes),
    )
    .map_err(::serde::de::Error::custom)
}

pub(crate) async fn handler(
    query: RequestKnownRangesForFeedQuery,
    state: ::std::sync::Arc<crate::State>,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    let request = query.query;

    let identity = ::ed25519_dalek::PublicKey::from_bytes(&request.public_key)
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let mut transaction =
        state.pool.begin().await.map_err(|e| {
            crate::RequestError::Anyhow(::anyhow::Error::new(e))
        })?;

    let writers_for_feed_rows =
        crate::postgres::writer_heads_for_identity(&mut transaction, &identity)
            .await
            .map_err(|_| crate::RequestError::DatabaseFailed)?;

    let mut result = crate::protocol::ResponseKnownRangesForFeed::default();

    for writers_for_feed_row in writers_for_feed_rows {
        let mut writer_and_ranges = crate::protocol::WriterAndRanges::new();

        writer_and_ranges.writer_id = writers_for_feed_row.writer_id.clone();

        let writer =
            crate::model::vec_to_writer_id(&writers_for_feed_row.writer_id)
                .map_err(|e| crate::RequestError::Anyhow(e))?;

        let ranges_for_writer_rows = crate::postgres::ranges_for_writer(
            &mut transaction,
            &identity,
            &writer,
        )
        .await
        .map_err(|_| crate::RequestError::DatabaseFailed)?;

        for ranges_for_writer_row in ranges_for_writer_rows {
            let mut range = crate::protocol::Range::new();
            range.low = ranges_for_writer_row.start_number as u64;
            range.high = ranges_for_writer_row.end_number as u64;
            writer_and_ranges.ranges.push(range);
        }

        result.writers.push(writer_and_ranges);
    }

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
