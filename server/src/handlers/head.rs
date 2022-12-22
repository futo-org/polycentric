use ::protobuf::Message;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    let request =
        crate::protocol::RequestEventsHead::parse_from_tokio_bytes(&bytes)
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;

    let identity =
        ::ed25519_dalek::PublicKey::from_bytes(&request.author_public_key)
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;

    let mut history: ::std::vec::Vec<crate::postgres::store_item::StoreItem> =
        vec![];

    let mut transaction =
        state.pool.begin().await.map_err(|e| {
            crate::RequestError::Anyhow(::anyhow::Error::new(e))
        })?;

    let writer_heads_query_rows =
        crate::postgres::writer_heads_for_identity(&mut transaction, &identity)
            .await
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;

    for row in &writer_heads_query_rows {
        let mut client_head = 0;

        for clock in &request.clocks {
            if clock.key == row.writer_id {
                client_head = clock.value;

                break;
            }
        }

        if (client_head as i64) < row.largest_sequence_number {
            let writer = crate::model::vec_to_writer_id(&row.writer_id)
                .map_err(|e| crate::RequestError::Anyhow(e))?;

            let mut rows = crate::postgres::load_range(
                &mut transaction,
                &identity,
                &writer,
                client_head,
                row.largest_sequence_number
                    .try_into()
                    .map_err(|e|
                        crate::RequestError::Anyhow(::anyhow::Error::new(e))
                    )?,
            )
            .await
            .map_err(|e| crate::RequestError::Anyhow(e))?;

            history.append(&mut rows);
        }
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

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}
