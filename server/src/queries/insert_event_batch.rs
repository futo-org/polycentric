pub(crate) async fn insert_event_batch(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
    server_time: u64,
) -> ::anyhow::Result<()> {
    let query_insert_event = "
        INSERT INTO events
        (
            system_key_type,
            system_key,
            process,
            logical_clock,
            content_type,
            content,
            vector_clock,
            indices,
            signature,
            raw_event,
            server_time,
            unix_milliseconds
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id;
    ";

    Ok(())
}

