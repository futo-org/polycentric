use ::protobuf::Message;

pub (crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    let request =
        crate::protocol::RequestKnownRanges::parse_from_tokio_bytes(&bytes)
            .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let identity = ::ed25519_dalek::PublicKey::from_bytes(
        &request.author_public_key,
    ).map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let writer = crate::model::vec_to_writer_id(
        &request.writer_id,
    ).map_err(|e| crate::RequestError::Anyhow(e))?;

    let mut known_ranges = crate::protocol::KnownRanges::new();

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let ranges_for_writer_rows = crate::postgres::ranges_for_writer(
        &mut transaction,
        &identity,
        &writer
    ).await.map_err(|_| crate::RequestError::DatabaseFailed)?;

    transaction
        .commit()
        .await
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    for ranges_for_writer_row in ranges_for_writer_rows {
        let mut range = crate::protocol::Range::new();
        range.low = ranges_for_writer_row.start_number as u64;
        range.high = ranges_for_writer_row.end_number as u64;
        known_ranges.ranges.push(range);
    }

    let result_serialized = known_ranges
        .write_to_bytes()
        .map_err(|_| crate::RequestError::SerializationFailed)?;

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}


