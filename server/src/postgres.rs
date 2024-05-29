use ::protobuf::Message;
use ::std::convert::TryFrom;

#[derive(::sqlx::Type)]
#[sqlx(type_name = "link_type")]
#[sqlx(rename_all = "snake_case")]
pub(crate) enum LinkType {
    React,
    Boost,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
struct EventRow {
    #[sqlx(try_from = "i64")]
    id: u64,
    #[sqlx(try_from = "i64")]
    system_key_type: u64,
    system_key: ::std::vec::Vec<u8>,
    process: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    logical_clock: u64,
    #[sqlx(try_from = "i64")]
    content_type: u64,
    content: ::std::vec::Vec<u8>,
    vector_clock: ::std::vec::Vec<u8>,
    indices: ::std::vec::Vec<u8>,
    signature: ::std::vec::Vec<u8>,
    raw_event: ::std::vec::Vec<u8>,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
struct ExploreRow {
    #[sqlx(try_from = "i64")]
    id: u64,
    #[sqlx(try_from = "i64")]
    server_time: u64,
    raw_event: ::std::vec::Vec<u8>,
}

#[allow(dead_code)]
#[derive(PartialEq, Debug, ::sqlx::FromRow)]
struct RangeRow {
    process: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    low: u64,
    #[sqlx(try_from = "i64")]
    high: u64,
}

#[allow(dead_code)]
#[derive(PartialEq, Debug, ::sqlx::FromRow)]
struct SystemRow {
    system_key: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    system_key_type: u64,
}

pub(crate) struct EventsAndCursor {
    pub events: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
    pub cursor: Option<u64>,
}

pub(crate) async fn load_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
) -> ::anyhow::Result<Option<crate::model::signed_event::SignedEvent>> {
    let query = "
        SELECT raw_event FROM events
        WHERE system_key_type = $1
        AND   system_key      = $2
        AND   process         = $3
        AND   logical_clock   = $4
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .fetch_optional(&mut **transaction)
        .await?;

    match potential_raw {
        Some(raw) => Ok(Some(crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
        )?)),
        None => Ok(None),
    }
}

pub(crate) async fn load_events_after_id(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    start_id: &::std::option::Option<u64>,
    limit: u64,
) -> ::anyhow::Result<EventsAndCursor> {
    let query = "
        SELECT
            id, raw_event, server_time
        FROM
            events
        WHERE
            ($1 IS NULL OR id > $1)
        ORDER BY
            id ASC
        LIMIT $2;
    ";

    let start_id_query = if let Some(x) = start_id {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let rows = ::sqlx::query_as::<_, ExploreRow>(query)
        .bind(start_id_query)
        .bind(i64::try_from(limit)?)
        .fetch_all(&mut **transaction)
        .await?;

    let mut result_set = vec![];

    for row in rows.iter() {
        let event = crate::model::signed_event::from_vec(&row.raw_event)?;
        result_set.push(event);
    }

    let result = EventsAndCursor {
        events: result_set,
        cursor: rows.last().map(|last_elem| last_elem.id),
    };

    Ok(result)
}

pub(crate) async fn load_posts_before_id(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    start_id: u64,
    limit: u64,
) -> ::anyhow::Result<EventsAndCursor> {
    let query = "
        SELECT id, raw_event, server_time FROM events
        WHERE id < $1
        AND content_type = $2
        ORDER BY id DESC
        LIMIT $3;
    ";

    let rows = ::sqlx::query_as::<_, ExploreRow>(query)
        .bind(i64::try_from(start_id)?)
        .bind(i64::try_from(crate::model::known_message_types::POST)?)
        .bind(i64::try_from(limit)?)
        .fetch_all(&mut **transaction)
        .await?;

    let mut result_set = vec![];

    for row in rows.iter() {
        let event = crate::model::signed_event::from_vec(&row.raw_event)?;
        result_set.push(event);
    }

    let result = EventsAndCursor {
        events: result_set,
        cursor: rows.last().map(|last_elem| last_elem.id),
    };

    Ok(result)
}

pub(crate) async fn load_processes_for_system(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::process::Process>> {
    let query = "
        SELECT DISTINCT process
        FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
                    system,
                    ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::process::from_vec(raw)
        })
    .collect::<::anyhow::Result<
        ::std::vec::Vec<crate::model::process::Process>,
        >>()
}

pub(crate) async fn load_latest_event_by_type(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    content_type: u64,
    limit: u64,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let query = "
        SELECT raw_event FROM events
        WHERE system_key_type = $1
        AND   system_key      = $2
        AND   process         = $3
        AND   content_type    = $4
        ORDER BY logical_clock DESC
        LIMIT $5;
    ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(content_type)?)
        .bind(i64::try_from(limit)?)
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::signed_event::from_proto(
                &crate::protocol::SignedEvent::parse_from_bytes(raw)?,
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()
}

pub(crate) async fn load_latest_system_wide_lww_event_by_type(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    content_type: u64,
) -> ::anyhow::Result<Option<crate::model::signed_event::SignedEvent>> {
    let query = "
        SELECT
            events.raw_event
        FROM
            events 
        INNER JOIN
            lww_elements 
        ON
            events.id = lww_elements.event_id 
        WHERE
            events.system_key_type = $1
        AND
            events.system_key = $2
        AND
            events.content_type = $3
        ORDER BY
            lww_elements.unix_milliseconds DESC,
            events.process DESC
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(i64::try_from(content_type)?)
        .fetch_optional(&mut **transaction)
        .await?;

    match potential_raw {
        Some(raw) => Ok(Some(crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
        )?)),
        None => Ok(None),
    }
}

pub(crate) fn claim_fields_to_json_object(
    fields: &[crate::protocol::ClaimFieldEntry],
) -> ::serde_json::Value {
    ::serde_json::Value::Object(
        fields
            .iter()
            .map(|field| {
                (
                    field.key.to_string(),
                    ::serde_json::Value::String(field.value.clone()),
                )
            })
            .collect::<::serde_json::Map<String, ::serde_json::Value>>(),
    )
}

pub(crate) async fn load_system_head(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let query = "
        SELECT DISTINCT ON (
            system_key_type,
            system_key,
            process
        )
        raw_event
        FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        ORDER BY system_key_type, system_key, process, logical_clock DESC;
    ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::signed_event::from_proto(
                &crate::protocol::SignedEvent::parse_from_bytes(raw)?,
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()
}

pub(crate) async fn load_event_ranges(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    ranges: &crate::protocol::RangesForSystem,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let mut result = vec![];

    for process_ranges in ranges.ranges_for_processes.iter() {
        let process =
            crate::model::process::from_vec(&process_ranges.process.process)?;

        for range in process_ranges.ranges.iter() {
            for logical_clock in range.low..=range.high {
                let potential_event =
                    load_event(transaction, system, &process, logical_clock)
                        .await?;

                if let Some(event) = potential_event {
                    result.push(event);
                }
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
pub mod tests {
    use ::protobuf::Message;

    #[::sqlx::test]
    async fn test_prepare_database(pool: ::sqlx::PgPool) -> ::sqlx::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    #[::sqlx::test]
    async fn test_persist_event(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = crate::model::tests::make_test_keypair();
        let process = crate::model::tests::make_test_process();

        let signed_event =
            crate::model::tests::make_test_event(&keypair, &process, 52);

        crate::ingest::ingest_event_postgres(&mut transaction, &signed_event)
            .await?;

        let system = crate::model::public_key::PublicKey::Ed25519(
            keypair.verifying_key().clone(),
        );

        let loaded_event = crate::postgres::load_event(
            &mut transaction,
            &system,
            &process,
            52,
        )
        .await?;

        transaction.commit().await?;

        assert!(Some(signed_event) == loaded_event);

        Ok(())
    }

    #[::sqlx::test]
    async fn test_head(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = crate::model::tests::make_test_keypair();
        let s2 = crate::model::tests::make_test_keypair();

        let s1p1 = crate::model::tests::make_test_process();
        let s1p2 = crate::model::tests::make_test_process();
        let s2p1 = crate::model::tests::make_test_process();

        let s1p1e1 = crate::model::tests::make_test_event(&s1, &s1p1, 1);
        let s1p1e2 = crate::model::tests::make_test_event(&s1, &s1p1, 2);
        let s1p2e1 = crate::model::tests::make_test_event(&s1, &s1p2, 1);
        let s2p1e5 = crate::model::tests::make_test_event(&s2, &s2p1, 5);

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e5).await?;

        let system = crate::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );

        let head = crate::postgres::load_system_head(&mut transaction, &system)
            .await?;

        transaction.commit().await?;

        let expected = vec![s1p1e2, s1p2e1];

        assert!(expected.len() == head.len());

        for expected_item in expected.iter() {
            let mut found = false;

            for got_item in head.iter() {
                if got_item == expected_item {
                    found = true;
                    break;
                }
            }

            assert!(found);
        }

        Ok(())
    }

    #[::sqlx::test]
    async fn test_known_ranges(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = crate::model::tests::make_test_keypair();
        let s2 = crate::model::tests::make_test_keypair();

        let s1p1 = crate::model::tests::make_test_process();
        let s1p2 = crate::model::tests::make_test_process();
        let s2p1 = crate::model::tests::make_test_process();

        let s1p1e1 = crate::model::tests::make_test_event(&s1, &s1p1, 1);
        let s1p1e2 = crate::model::tests::make_test_event(&s1, &s1p1, 2);
        let s1p1e6 = crate::model::tests::make_test_event(&s1, &s1p1, 6);
        let s1p2e1 = crate::model::tests::make_test_event(&s1, &s1p2, 1);
        let s2p1e5 = crate::model::tests::make_test_event(&s2, &s2p1, 5);

        let mut delete = crate::protocol::Delete::new();
        delete.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(&s1p1),
        );
        delete.logical_clock = 2;
        delete.indices =
            ::protobuf::MessageField::some(crate::protocol::Indices::new());

        let s1p1e3 = crate::model::tests::make_test_event_with_content(
            &s1,
            &s1p1,
            3,
            0,
            &delete.write_to_bytes()?,
            vec![],
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e3).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e6).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e5).await?;

        let system = crate::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );

        let ranges =
            crate::postgres::known_ranges_for_system(&mut transaction, &system)
                .await?;

        transaction.commit().await?;

        let mut expected = crate::protocol::RangesForSystem::new();

        let mut expected_p1 = crate::protocol::RangesForProcess::new();
        expected_p1.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(&s1p1),
        );

        let mut expected_p1r1 = crate::protocol::Range::new();
        expected_p1r1.low = 1;
        expected_p1r1.high = 3;

        let mut expected_p1r2 = crate::protocol::Range::new();
        expected_p1r2.low = 6;
        expected_p1r2.high = 6;

        expected_p1.ranges.push(expected_p1r1);
        expected_p1.ranges.push(expected_p1r2);

        let mut expected_p2 = crate::protocol::RangesForProcess::new();
        expected_p2.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(&s1p2),
        );

        let mut expected_p2r1 = crate::protocol::Range::new();
        expected_p2r1.low = 1;
        expected_p2r1.high = 1;

        expected_p2.ranges.push(expected_p2r1);

        expected.ranges_for_processes.push(expected_p1);
        expected.ranges_for_processes.push(expected_p2);

        assert!(
            expected.ranges_for_processes.len()
                == ranges.ranges_for_processes.len()
        );

        for expected_item in expected.ranges_for_processes.iter() {
            let mut found = false;

            for got_item in ranges.ranges_for_processes.iter() {
                if got_item == expected_item {
                    found = true;
                    break;
                }
            }

            assert!(found);
        }

        Ok(())
    }

    #[::sqlx::test]
    async fn test_handles(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = crate::model::tests::make_test_keypair();
        let s2 = crate::model::tests::make_test_keypair();

        let system1 = crate::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );

        let system2 = crate::model::public_key::PublicKey::Ed25519(
            s2.verifying_key().clone(),
        );

        transaction.commit().await?;

        transaction = pool.begin().await?;
        crate::postgres::claim_handle(
            &mut transaction,
            String::from("osotnoc"),
            &system1,
        )
        .await?;

        transaction.commit().await?;

        transaction = pool.begin().await?;
        assert!(
            crate::postgres::claim_handle(
                &mut transaction,
                String::from("osotnoc_2"),
                &system1
            )
            .await
            .is_ok()
                == true
        );

        transaction.commit().await?;

        transaction = pool.begin().await?;
        assert!(
            crate::postgres::claim_handle(
                &mut transaction,
                String::from("osotnoc"),
                &system1
            )
            .await
            .is_ok()
                == true
        );

        transaction.commit().await?;

        transaction = pool.begin().await?;
        assert!(
            crate::postgres::claim_handle(
                &mut transaction,
                String::from("osotnoc"),
                &system2
            )
            .await
            .is_ok()
                == false
        );

        transaction = pool.begin().await?;
        crate::postgres::claim_handle(
            &mut transaction,
            String::from("futo_test"),
            &system2,
        )
        .await?;
        transaction.commit().await?;

        transaction = pool.begin().await?;
        assert!(
            crate::postgres::resolve_handle(
                &mut transaction,
                String::from("futo_test")
            )
            .await?
                == system2
        );
        assert!(
            crate::postgres::resolve_handle(
                &mut transaction,
                String::from("osotnoc")
            )
            .await?
                != system2
        );
        assert!(
            crate::postgres::resolve_handle(
                &mut transaction,
                String::from("osotnoc")
            )
            .await?
                == system1
        );

        Ok(())
    }
}
