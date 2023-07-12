use ::anyhow::Context;
use ::protobuf::Message;

#[derive(PartialEq)]
pub(crate) struct Result {
    pub(crate) events: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
    pub(crate) proof: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
}

pub(crate) async fn query_index(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    content_type: u64,
    limit: u64,
    cursor: &::std::option::Option<u64>,
) -> ::anyhow::Result<Result> {
    let mut result = Result {
        events: vec![],
        proof: vec![],
    };

    result.events = load_events_by_time(
        &mut *transaction,
        system,
        content_type,
        limit,
        cursor,
    )
    .await?;

    if result.events.is_empty() {
        return Ok(result);
    }

    let processes =
        crate::postgres::load_processes_for_system(&mut *transaction, system)
            .await?;

    let latest_event = crate::model::event::from_vec(
        result.events.first().context("impossible")?.event(),
    )?;

    let earliest_event = crate::model::event::from_vec(
        result.events.last().context("impossible")?.event(),
    )?;

    let latest_time = latest_event
        .unix_milliseconds()
        .context("latest_event lacked time")?;

    let earliest_time = earliest_event
        .unix_milliseconds()
        .context("earliest_event lacked time")?;

    for process in processes.iter() {
        if process != latest_event.process() {
            let potential_later = load_event_later_than(
                &mut *transaction,
                system,
                process,
                content_type,
                latest_time,
            )
            .await?;

            if let Some(later) = potential_later {
                result.proof.push(later);
            }
        }

        if process != earliest_event.process() {
            let potential_earlier = load_event_earlier_than(
                &mut *transaction,
                system,
                process,
                content_type,
                earliest_time,
            )
            .await?;

            if let Some(earlier) = potential_earlier {
                result.proof.push(earlier);
            }
        }
    }

    Ok(result)
}

pub(crate) async fn load_event_later_than(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    content_type: u64,
    later_than_unix_milliseconds: u64,
) -> ::anyhow::Result<
    ::std::option::Option<crate::model::signed_event::SignedEvent>,
> {
    let query = "
        SELECT
            raw_event
        FROM (
            SELECT
                raw_event as raw_event,
                unix_milliseconds,
                process,
                logical_clock,
                system_key_type,
                system_key,
                content_type
            FROM
                events
            UNION
            SELECT
                events.raw_event as raw_event,
                deletions.unix_milliseconds as unix_milliseconds,
                deletions.process as process,
                deletions.logical_clock as logical_clock,
                deletions.system_key_type as system_key_type,
                deletions.system_key as system_key,
                deletions.content_type as content_type
            FROM
                deletions
            INNER JOIN
                events
            ON
                events.id = deletions.event_id
        ) x
        WHERE
            system_key_type = $1
        AND
            system_key = $2
        AND
            process = $3
        AND
            content_type = $4
        AND
            unix_milliseconds >= $5
        ORDER BY
            unix_milliseconds
        ASC,
            logical_clock
        ASC
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(content_type)?)
        .bind(i64::try_from(later_than_unix_milliseconds)?)
        .fetch_optional(&mut *transaction)
        .await?;

    match potential_raw {
        Some(raw) => Ok(Some(crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
        )?)),
        None => Ok(None),
    }
}

pub(crate) async fn load_event_earlier_than(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    content_type: u64,
    earlier_than_unix_milliseconds: u64,
) -> ::anyhow::Result<
    ::std::option::Option<crate::model::signed_event::SignedEvent>,
> {
    let query = "
        SELECT
            raw_event
        FROM (
            SELECT
                raw_event as raw_event,
                unix_milliseconds,
                process,
                logical_clock,
                system_key_type,
                system_key,
                content_type
            FROM
                events
            UNION
            SELECT
                events.raw_event as raw_event,
                deletions.unix_milliseconds as unix_milliseconds,
                deletions.process as process,
                deletions.logical_clock as logical_clock,
                deletions.system_key_type as system_key_type,
                deletions.system_key as system_key,
                deletions.content_type as content_type
            FROM
                deletions
            INNER JOIN
                events
            ON
                events.id = deletions.event_id
        ) x
        WHERE
            system_key_type = $1
        AND
            system_key = $2
        AND
            process = $3
        AND
            content_type = $4
        AND
            unix_milliseconds <= $5
        ORDER BY
            unix_milliseconds
        DESC,
            logical_clock
        DESC
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(content_type)?)
        .bind(i64::try_from(earlier_than_unix_milliseconds)?)
        .fetch_optional(&mut *transaction)
        .await?;

    match potential_raw {
        Some(raw) => Ok(Some(crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
        )?)),
        None => Ok(None),
    }
}

pub(crate) async fn load_events_by_time(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    content_type: u64,
    limit: u64,
    after: &::std::option::Option<u64>,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let query = "
        SELECT
            raw_event
        FROM (
            SELECT
                raw_event as raw_event,
                unix_milliseconds,
                process,
                logical_clock,
                system_key_type,
                system_key,
                content_type
            FROM
                events
            UNION
            SELECT
                events.raw_event as raw_event,
                deletions.unix_milliseconds as unix_milliseconds,
                deletions.process as process,
                deletions.logical_clock as logical_clock,
                deletions.system_key_type as system_key_type,
                deletions.system_key as system_key,
                deletions.content_type as content_type
            FROM
                deletions
            INNER JOIN
                events
            ON
                events.id = deletions.event_id
        ) x
        WHERE
            system_key_type = $1
        AND
            system_key = $2
        AND
            content_type = $3
        AND
            ($4 IS NULL OR unix_milliseconds < $4)
        ORDER BY
            unix_milliseconds
        DESC,
            process
        DESC,
            logical_clock
        DESC
        LIMIT $5
    ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(i64::try_from(content_type)?)
        .bind(after.map(i64::try_from).transpose()?)
        .bind(i64::try_from(limit)?)
        .fetch_all(&mut *transaction)
        .await?
        .iter()
        .map(|raw| crate::model::signed_event::from_vec(raw))
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()
}

#[cfg(test)]
pub mod tests {
    #[::sqlx::test]
    async fn test_no_events(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = crate::model::tests::make_test_keypair();

        let system = crate::model::public_key::PublicKey::Ed25519(
            keypair.public.clone(),
        );

        let result = crate::queries::query_index::query_index(
            &mut transaction,
            &system,
            crate::model::known_message_types::POST,
            10,
            &None,
        )
        .await?;

        transaction.commit().await?;

        assert!(
            result
                == crate::queries::query_index::Result {
                    events: vec![],
                    proof: vec![],
                }
        );

        Ok(())
    }

    #[::sqlx::test]
    async fn test_single_process(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = crate::model::tests::make_test_keypair();
        let s1p1 = crate::model::tests::make_test_process();

        let s1p1e1 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 1, 12);
        let s1p1e2 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 2, 13);
        let s1p1e3 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 3, 14);
        let s1p1e4 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 4, 15);
        let s1p1e5 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 5, 20);

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e3).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e4).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e5).await?;

        let system =
            crate::model::public_key::PublicKey::Ed25519(s1.public.clone());

        let result = crate::queries::query_index::query_index(
            &mut transaction,
            &system,
            crate::model::known_message_types::POST,
            4,
            &None,
        )
        .await?;

        transaction.commit().await?;

        assert!(
            result.events
                == vec![
                    s1p1e5.clone(),
                    s1p1e4.clone(),
                    s1p1e3.clone(),
                    s1p1e2.clone(),
                ],
        );

        assert!(result.proof == vec![]);

        Ok(())
    }

    #[::sqlx::test]
    async fn test_multi_process(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = crate::model::tests::make_test_keypair();
        let s1p1 = crate::model::tests::make_test_process();
        let s1p2 = crate::model::tests::make_test_process();
        let s1p3 = crate::model::tests::make_test_process();

        let s1p1e1 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 1, 12);
        let s1p1e2 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 2, 13);
        let s1p1e3 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 3, 14);
        let s1p1e4 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 4, 15);
        let s1p1e5 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 5, 20);

        let s1p2e1 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p2, 1, 9);
        let s1p2e2 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p2, 2, 16);
        let s1p2e3 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p2, 3, 19);

        let s1p3e1 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p3, 1, 8);
        let s1p3e2 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p3, 2, 17);
        let s1p3e3 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p3, 3, 18);

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e3).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e4).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e5).await?;

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e3).await?;

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p3e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p3e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p3e3).await?;

        let system =
            crate::model::public_key::PublicKey::Ed25519(s1.public.clone());

        let result = crate::queries::query_index::query_index(
            &mut transaction,
            &system,
            crate::model::known_message_types::POST,
            4,
            &None,
        )
        .await?;

        transaction.commit().await?;

        assert!(
            result.events
                == vec![
                    s1p1e5.clone(),
                    s1p2e3.clone(),
                    s1p3e3.clone(),
                    s1p3e2.clone(),
                ],
        );

        let proof = vec![s1p1e4, s1p2e2];

        assert!(proof.iter().all(|item| result.proof.contains(item)));

        Ok(())
    }

    #[::sqlx::test]
    async fn test_single_process_with_delete(
        pool: ::sqlx::PgPool,
    ) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = crate::model::tests::make_test_keypair();
        let s1p1 = crate::model::tests::make_test_process();

        let s1p1e1 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 1, 12);
        let s1p1e2 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 2, 13);
        let s1p1e3 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 3, 14);
        let s1p1e4 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 4, 15);
        let s1p1e5 =
            crate::model::tests::make_test_event_with_time(&s1, &s1p1, 5, 20);

        let s1p1e6 = crate::model::tests::make_delete_event_from_event(
            &s1, &s1p1, &s1p1e3, 6, 21,
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e3).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e4).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e5).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e6).await?;

        let system =
            crate::model::public_key::PublicKey::Ed25519(s1.public.clone());

        let result = crate::queries::query_index::query_index(
            &mut transaction,
            &system,
            crate::model::known_message_types::POST,
            4,
            &None,
        )
        .await?;

        transaction.commit().await?;

        assert!(
            result.events
                == vec![
                    s1p1e5.clone(),
                    s1p1e4.clone(),
                    s1p1e6.clone(),
                    s1p1e2.clone(),
                ],
        );

        assert!(result.proof == vec![]);

        Ok(())
    }
}
