#[derive(PartialEq)]
pub(crate) struct QueryResult {
    pub(crate) cursor: ::std::option::Option<u64>,
    pub(crate) events: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
}

fn process_rows(
    rows: Vec<::tokio_postgres::Row>,
    limit: u64,
    cursor: &::std::option::Option<u64>,
) -> ::anyhow::Result<QueryResult> {
    Ok(QueryResult {
        cursor: if rows.len() == TryInto::<usize>::try_into(limit)? {
            if let Some(position) = cursor {
                Some(position + limit)
            } else {
                Some(limit)
            }
        } else {
            None
        },
        events: rows
            .iter()
            .map(|row| {
                let raw_event: Vec<u8> = row.try_get(0)?;
                crate::model::signed_event::from_vec(&raw_event)
            })
            .collect::<::anyhow::Result<
                ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
            >>()?,
    })
}

const LIKES_DISLIKES_QUERY_FRAGMENT: &str = "
    LEFT JOIN
        count_lww_element_references_pointer as likes
    ON
        events.system_key_type = likes.subject_system_key_type
    AND
        events.system_key = likes.subject_system_key
    AND
        events.process = likes.subject_process
    AND
        events.logical_clock = likes.subject_logical_clock
    AND
        likes.value = '\\001'::bytea
    LEFT JOIN
        count_lww_element_references_pointer as dislikes
    ON
        events.system_key_type = dislikes.subject_system_key_type
    AND
        events.system_key = dislikes.subject_system_key
    AND
        events.process = dislikes.subject_process
    AND
        events.logical_clock = dislikes.subject_logical_clock
    AND
        dislikes.value = '\\002'::bytea
";

pub(crate) async fn select_pointer(
    transaction: &::deadpool_postgres::Transaction<'_>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
    from_type: &::std::option::Option<u64>,
    cursor: &::std::option::Option<u64>,
    limit: u64,
) -> ::anyhow::Result<QueryResult> {
    let query = format!(
        "
        SELECT
            events.raw_event as raw_event
        FROM
            events
        JOIN
            event_links
        ON
            event_links.event_id = events.id
        {LIKES_DISLIKES_QUERY_FRAGMENT}
        WHERE
            event_links.subject_system_key_type = $1
        AND
            event_links.subject_system_key = $2
        AND
            event_links.subject_process = $3
        AND
            event_links.subject_logical_clock = $4
        AND
            ($5 IS NULL OR events.content_type = $5)
        ORDER BY
            (COALESCE(likes.count, 0) - COALESCE(dislikes.count, 0)) DESC,
            events.id DESC
        OFFSET COALESCE($6, 0)
        LIMIT $7
    "
    );

    let statement = transaction.prepare_cached(&query).await?;

    let from_type_query = if let Some(x) = from_type {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let cursor_query = if let Some(x) = cursor {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let rows = transaction
        .query(
            &statement,
            &[
                &i64::try_from(crate::model::public_key::get_key_type(system))?,
                &crate::model::public_key::get_key_bytes(system),
                &process.bytes(),
                &i64::try_from(logical_clock)?,
                &from_type_query,
                &cursor_query,
                &i64::try_from(limit)?,
            ],
        )
        .await?;

    process_rows(rows, limit, cursor)
}

pub(crate) async fn select_bytes(
    transaction: &::deadpool_postgres::Transaction<'_>,
    bytes: &::std::vec::Vec<::std::vec::Vec<u8>>,
    from_type: &::std::option::Option<u64>,
    cursor: &::std::option::Option<u64>,
    limit: u64,
) -> ::anyhow::Result<QueryResult> {
    let query = format!(
        "
        SELECT
            events.raw_event as raw_event
        FROM
            events
        JOIN
            event_references_bytes
        ON
            event_references_bytes.event_id = events.id
        {LIKES_DISLIKES_QUERY_FRAGMENT}
        WHERE
            event_references_bytes.subject_bytes = ANY($1)
        AND
            ($2 IS NULL OR events.content_type = $2)
        GROUP BY
            events.id
        ORDER BY
            (SUM(COALESCE(likes.count, 0)) - SUM(COALESCE(dislikes.count, 0))) DESC,
            events.id DESC
        OFFSET COALESCE($3, 0)
        LIMIT $4
    "
    );

    let statement = transaction.prepare_cached(&query).await?;

    let from_type_query = if let Some(x) = from_type {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let cursor_query = if let Some(x) = cursor {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let rows = transaction
        .query(
            &statement,
            &[
                &bytes,
                &from_type_query,
                &cursor_query,
                &i64::try_from(limit)?,
            ],
        )
        .await?;

    process_rows(rows, limit, cursor)
}

pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    reference: &crate::model::PointerOrByteReferences,
    from_type: &::std::option::Option<u64>,
    cursor: &::std::option::Option<u64>,
    limit: u64,
) -> ::anyhow::Result<QueryResult> {
    match reference {
        crate::model::PointerOrByteReferences::Pointer(pointer) => {
            select_pointer(
                transaction,
                pointer.system(),
                pointer.process(),
                *pointer.logical_clock(),
                from_type,
                cursor,
                limit,
            )
            .await
        }
        crate::model::PointerOrByteReferences::Bytes(bytes) => {
            select_bytes(transaction, bytes, from_type, cursor, limit).await
        }
    }
}
