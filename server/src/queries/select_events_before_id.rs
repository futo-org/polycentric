pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    start_id: u64,
    limit: u64,
) -> ::anyhow::Result<crate::postgres::EventsAndCursor> {
    let query = "
        SELECT id, raw_event, server_time FROM events
        WHERE id < $1
        AND content_type = 3
        ORDER BY id DESC
        LIMIT $2;
    ";

    let statement = transaction.prepare_cached(query).await?;

    let rows = transaction
        .query(
            &statement,
            &[&i64::try_from(start_id)?, &i64::try_from(limit)?],
        )
        .await?;

    let mut result_set = vec![];

    for row in rows.iter() {
        result_set.push(crate::model::signed_event::from_vec(row.try_get(0)?)?);
    }

    let cursor = if let Some(last) = rows.last() {
        let id: i64 = last.try_get(1)?;
        Some(u64::try_from(id)?)
    } else {
        None
    };

    let result = crate::postgres::EventsAndCursor {
        events: result_set,
        cursor: cursor,
    };

    Ok(result)
}
