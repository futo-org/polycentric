use ::protobuf::Message;

#[derive(::sqlx::FromRow)]
struct QueryRow {
    #[sqlx(try_from = "i64")]
    id: u64,
    raw_event: ::std::vec::Vec<u8>,
}

#[derive(PartialEq)]
pub(crate) struct QueryResult {
    pub(crate) cursor: ::std::option::Option<u64>,
    pub(crate) events: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
}

fn process_rows(
    rows: std::vec::Vec<QueryRow>,
) -> ::anyhow::Result<QueryResult> {
    let mut result = QueryResult {
        cursor: None,
        events: vec![],
    };

    for row in rows.iter() {
        if let Some(cursor) = result.cursor {
            if cursor < row.id {
                result.cursor = Some(row.id)
            }
        } else {
            result.cursor = Some(row.id)
        }

        let event = crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(&row.raw_event)?,
        )?;

        result.events.push(event);
    }

    Ok(result)
}

pub(crate) async fn query_pointer(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
    from_type: &::std::option::Option<u64>,
    cursor: &::std::option::Option<u64>,
) -> ::anyhow::Result<QueryResult> {
    let query = "
        SELECT
            id, raw_event
        FROM
            events
        WHERE
            id
        IN (
            SELECT
                event_id as id
            FROM
                event_links
            WHERE
                subject_system_key_type = $1
            AND
                subject_system_key = $2
            AND
                subject_process = $3
            AND
                subject_logical_clock = $4
        )
        AND
            ($5 IS NULL OR content_type = $5)
        AND
            ($6 IS NULL OR id < $6)
        LIMIT 20
    ";

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

    let rows = ::sqlx::query_as::<_, QueryRow>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .bind(from_type_query)
        .bind(cursor_query)
        .fetch_all(&mut *transaction)
        .await?;

    process_rows(rows)
}

pub(crate) async fn query_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    bytes: &::std::vec::Vec<u8>,
    from_type: &::std::option::Option<u64>,
    cursor: &::std::option::Option<u64>,
) -> ::anyhow::Result<QueryResult> {
    let query = "
        SELECT
            id, raw_event
        FROM
            events
        WHERE
            id
        IN (
            SELECT
                event_id as id
            FROM
                event_references_bytes
            WHERE
                subject_bytes = $1
        )
        AND
            ($2 IS NULL OR content_type = $2)
        AND
            ($3 IS NULL OR id < $3)
        LIMIT 20
    ";

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

    let rows = ::sqlx::query_as::<_, QueryRow>(query)
        .bind(bytes)
        .bind(from_type_query)
        .bind(cursor_query)
        .fetch_all(&mut *transaction)
        .await?;

    process_rows(rows)
}

pub(crate) async fn query_references(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    reference: &crate::model::reference::Reference,
    from_type: &::std::option::Option<u64>,
    cursor: &::std::option::Option<u64>,
) -> ::anyhow::Result<QueryResult> {
    match reference {
        crate::model::reference::Reference::Pointer(pointer) => {
            query_pointer(
                &mut *transaction,
                &pointer.system(),
                &pointer.process(),
                *pointer.logical_clock(),
                from_type,
                cursor,
            )
            .await
        }
        crate::model::reference::Reference::Bytes(bytes) => {
            query_bytes(&mut *transaction, &bytes, from_type, cursor).await
        }
        _ => {
            unimplemented!("query identity not implemented");
        }
    }
}

#[cfg(test)]
pub mod tests {
    use ::protobuf::Message;

    #[::sqlx::test]
    async fn test_no_references(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = crate::model::tests::make_test_keypair();
        let process = crate::model::tests::make_test_process();

        let system = crate::model::public_key::PublicKey::Ed25519(
            keypair.public.clone(),
        );

        let result = crate::queries::query_references::query_pointer(
            &mut transaction,
            &system,
            &process,
            5,
            &None,
            &None,
        )
        .await?;

        transaction.commit().await?;

        let expected = crate::queries::query_references::QueryResult {
            cursor: None,
            events: vec![],
        };

        assert!(result == expected);

        Ok(())
    }
}
