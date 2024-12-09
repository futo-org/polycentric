use super::{ModerationFilters, ModerationOptions};

#[derive(::sqlx::FromRow)]
struct QueryRow {
    raw_event: ::std::vec::Vec<u8>,
}

#[derive(PartialEq)]
pub(crate) struct QueryResult {
    pub(crate) cursor: ::std::option::Option<u64>,
    pub(crate) events:
        ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
}

fn process_rows(
    rows: std::vec::Vec<QueryRow>,
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
                polycentric_protocol::model::signed_event::from_vec(
                    &row.raw_event,
                )
            })
            .collect::<::anyhow::Result<
                ::std::vec::Vec<
                    polycentric_protocol::model::signed_event::SignedEvent,
                >,
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

pub(crate) async fn query_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    process: &polycentric_protocol::model::process::Process,
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

    let rows = ::sqlx::query_as::<_, QueryRow>(&query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .bind(from_type_query)
        .bind(cursor_query)
        .bind(i64::try_from(limit)?)
        .fetch_all(&mut **transaction)
        .await?;

    process_rows(rows, limit, cursor)
}

pub(crate) async fn query_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    bytes: &::std::vec::Vec<::std::vec::Vec<u8>>,
    from_type: &::std::option::Option<u64>,
    cursor: &::std::option::Option<u64>,
    limit: u64,
    moderation_options: &ModerationOptions,
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
        AND
            filter_events_by_moderation(events, $3::moderation_filter_type[], $4::moderation_mode)
        GROUP BY
            events.id
        ORDER BY
            (SUM(COALESCE(likes.count, 0)) - SUM(COALESCE(dislikes.count, 0))) DESC,
            events.id DESC
        OFFSET COALESCE($5, 0)
        LIMIT $6
    "
    );

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

    let rows = ::sqlx::query_as::<_, QueryRow>(&query)
        .bind(bytes)
        .bind(from_type_query)
        .bind(cursor_query)
        .bind(i64::try_from(limit)?)
        .bind(
            moderation_options
                .filters
                .as_ref()
                .unwrap_or(&ModerationFilters::default()),
        )
        .bind(moderation_options.mode)
        .fetch_all(&mut **transaction)
        .await?;

    process_rows(rows, 20, cursor)
}

pub(crate) async fn query_references(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    reference: &polycentric_protocol::model::PointerOrByteReferences,
    from_type: &::std::option::Option<u64>,
    cursor: &::std::option::Option<u64>,
    limit: u64,
    moderation_options: &ModerationOptions,
) -> ::anyhow::Result<QueryResult> {
    match reference {
        polycentric_protocol::model::PointerOrByteReferences::Pointer(
            pointer,
        ) => {
            query_pointer(
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
        polycentric_protocol::model::PointerOrByteReferences::Bytes(bytes) => {
            query_bytes(
                transaction,
                bytes,
                from_type,
                cursor,
                limit,
                moderation_options,
            )
            .await
        }
    }
}

#[cfg(test)]
pub mod tests {
    #[::sqlx::test]
    async fn test_no_references(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = polycentric_protocol::test_utils::make_test_keypair();
        let process = polycentric_protocol::test_utils::make_test_process();

        let system =
            polycentric_protocol::model::public_key::PublicKey::Ed25519(
                keypair.verifying_key(),
            );

        let result = crate::postgres::query_references::query_pointer(
            &mut transaction,
            &system,
            &process,
            5,
            &None,
            &None,
            20,
        )
        .await?;

        transaction.commit().await?;

        let expected = crate::postgres::query_references::QueryResult {
            cursor: None,
            events: vec![],
        };

        assert!(result == expected);

        Ok(())
    }
}
