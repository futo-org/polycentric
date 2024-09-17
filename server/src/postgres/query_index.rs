use ::anyhow::Context;

#[derive(PartialEq)]
pub(crate) struct Result {
    pub(crate) events:
        ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
    pub(crate) proof:
        ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
}

pub(crate) async fn query_index(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    content_type: u64,
    limit: u64,
    cursor: &::std::option::Option<u64>,
    moderation_options: Option<ModerationOptions>,
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
        moderation_options.unwrap_or_default(),
    )
    .await?;

    if result.events.is_empty() {
        return Ok(result);
    }

    let processes =
        crate::postgres::load_processes_for_system(&mut *transaction, system)
            .await?;

    let latest_event = polycentric_protocol::model::event::from_vec(
        result.events.first().context("impossible")?.event(),
    )?;

    let earliest_event = polycentric_protocol::model::event::from_vec(
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
                transaction,
                system,
                process,
                content_type,
                latest_time,
                &moderation_filter_unwrapped,
            )
            .await?;

            if let Some(later) = potential_later {
                result.proof.push(later);
            }
        }

        if process != earliest_event.process() {
            let potential_earlier = load_event_earlier_than(
                transaction,
                system,
                process,
                content_type,
                earliest_time,
                moderation_options,
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
    system: &polycentric_protocol::model::public_key::PublicKey,
    process: &polycentric_protocol::model::process::Process,
    content_type: u64,
    later_than_unix_milliseconds: u64,
    moderation_options: Option<ModerationOptions>,
) -> ::anyhow::Result<
    ::std::option::Option<
        polycentric_protocol::model::signed_event::SignedEvent,
    >,
> {
    let query = "
        SELECT
            raw_event, moderation_tags
        FROM (
            SELECT
                raw_event as raw_event,
                moderation_tags as moderation_tags,
                unix_milliseconds,
                process,
                logical_clock,
                system_key_type,
                system_key,
                content_type
            FROM
                events
            WHERE
                filter_events_by_moderation(events, $6::moderation_filter_type[])
            UNION
            SELECT
                events.raw_event as raw_event,
                events.moderation_tags as moderation_tags,
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

    let potential_raw =
        ::sqlx::query_as::<_, crate::postgres::RawEventRow>(query)
            .bind(i64::try_from(polycentric_protocol::model::public_key::get_key_type(
                system,
            ))?)
            .bind(polycentric_protocol::model::public_key::get_key_bytes(system))
            .bind(process.bytes())
            .bind(i64::try_from(content_type)?)
            .bind(i64::try_from(later_than_unix_milliseconds)?)
            .bind(moderation_options.unwrap_or_default())
            .fetch_optional(&mut **transaction)
            .await?;

    match potential_raw {
        Some(raw) => Ok(Some(
            polycentric_protocol::model::signed_event::from_raw_event_with_moderation_tags(
                &raw.raw_event,
                &raw.moderation_tags.unwrap_or_default(),
            )?,
        )),
        None => Ok(None),
    }
}

pub(crate) async fn load_event_earlier_than(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    process: &polycentric_protocol::model::process::Process,
    content_type: u64,
    earlier_than_unix_milliseconds: u64,
    moderation_options: Option<ModerationOptions>,
) -> ::anyhow::Result<
    ::std::option::Option<
        polycentric_protocol::model::signed_event::SignedEvent,
    >,
> {
    let query = "
        SELECT
            raw_event, moderation_tags
        FROM (
            SELECT
                raw_event as raw_event,
                moderation_tags as moderation_tags,
                unix_milliseconds,
                process,
                logical_clock,
                system_key_type,
                system_key,
                content_type
            FROM
                events
            WHERE
                filter_events_by_moderation(events, $6::moderation_filter_type[])
            UNION
            SELECT
                events.raw_event as raw_event,
                events.moderation_tags as moderation_tags,
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

    let potential_raw =
        ::sqlx::query_as::<_, crate::postgres::RawEventRow>(query)
            .bind(i64::try_from(polycentric_protocol::model::public_key::get_key_type(
                system,
            ))?)
            .bind(polycentric_protocol::model::public_key::get_key_bytes(system))
            .bind(process.bytes())
            .bind(i64::try_from(content_type)?)
            .bind(i64::try_from(earlier_than_unix_milliseconds)?)
            .bind(moderation_options.unwrap_or_default())
            .fetch_optional(&mut **transaction)
            .await?;

    match potential_raw {
        Some(row) => Ok(Some(
            polycentric_protocol::model::signed_event::from_raw_event_with_moderation_tags(
                &row.raw_event,
                &row.moderation_tags.unwrap_or_default(),
            )?,
        )),
        None => Ok(None),
    }
}

pub(crate) async fn load_events_by_time(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    content_type: u64,
    limit: u64,
    after: &::std::option::Option<u64>,
    moderation_options: Option<ModerationOptions>,
) -> ::anyhow::Result<::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>>
{
    let query = "
        SELECT
            raw_event,
            moderation_tags
        FROM (
            SELECT
                raw_event as raw_event,
                moderation_tags as moderation_tags,
                unix_milliseconds,
                process,
                logical_clock,
                system_key_type,
                system_key,
                content_type
            FROM
                events
            WHERE
                filter_events_by_moderation(events, $6::moderation_filter_type[])
            UNION
            SELECT
                events.raw_event as raw_event,
                events.moderation_tags as moderation_tags,
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

    ::sqlx::query_as::<_, crate::postgres::RawEventRow>(query)
        .bind(i64::try_from(polycentric_protocol::model::public_key::get_key_type(
            system,
        )))
        .bind(i64::try_from(content_type)?)
        .bind(after.map(i64::try_from).transpose()?)
        .bind(i64::try_from(limit)?)
        .bind(moderation_options.unwrap_or_default())
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(|row| {
            polycentric_protocol::model::signed_event::from_raw_event_with_moderation_tags(
                &row.raw_event,
                row.moderation_tags.as_ref().unwrap_or(&vec![]),
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<
                polycentric_protocol::model::signed_event::SignedEvent,
            >,
        >>()
}

#[cfg(test)]
pub mod tests {
    #[::sqlx::test]
    async fn test_no_events(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = polycentric_protocol::test_utils::make_test_keypair();

        let system =
            polycentric_protocol::model::public_key::PublicKey::Ed25519(
                keypair.verifying_key().clone(),
            );

        let result = crate::postgres::query_index::query_index(
            &mut transaction,
            &system,
            polycentric_protocol::model::known_message_types::POST,
            10,
            &None,
            &Some(vec![]),
        )
        .await?;

        transaction.commit().await?;

        assert!(
            result
                == crate::postgres::query_index::Result {
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

        let s1 = polycentric_protocol::test_utils::make_test_keypair();
        let s1p1 = polycentric_protocol::test_utils::make_test_process();

        let s1p1e1 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 1, 12,
            );
        let s1p1e2 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 2, 13,
            );
        let s1p1e3 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 3, 14,
            );
        let s1p1e4 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 4, 15,
            );
        let s1p1e5 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 5, 20,
            );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e3).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e4).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e5).await?;

        let s1_key = polycentric_protocol::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );

        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            1,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            2,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            3,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            4,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            5,
        )
        .await?;

        let system = polycentric_protocol::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );

        let result = crate::postgres::query_index::query_index(
            &mut transaction,
            &system,
            polycentric_protocol::model::known_message_types::POST,
            4,
            &None,
            &Some(vec![]),
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

        let s1 = polycentric_protocol::test_utils::make_test_keypair();
        let s1p1 = polycentric_protocol::test_utils::make_test_process();
        let s1p2 = polycentric_protocol::test_utils::make_test_process();
        let s1p3 = polycentric_protocol::test_utils::make_test_process();

        let s1p1e1 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 1, 12,
            );
        let s1p1e2 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 2, 13,
            );
        let s1p1e3 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 3, 14,
            );
        let s1p1e4 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 4, 15,
            );
        let s1p1e5 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 5, 20,
            );

        let s1p2e1 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p2, 1, 9,
            );
        let s1p2e2 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p2, 2, 16,
            );
        let s1p2e3 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p2, 3, 19,
            );

        let s1p3e1 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p3, 1, 8,
            );
        let s1p3e2 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p3, 2, 17,
            );
        let s1p3e3 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p3, 3, 18,
            );

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

        let s1_key = polycentric_protocol::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );

        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            1,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            2,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            3,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            4,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            5,
        )
        .await?;

        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p2,
            1,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p2,
            2,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p2,
            3,
        )
        .await?;

        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p3,
            1,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p3,
            2,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p3,
            3,
        )
        .await?;

        let system = polycentric_protocol::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );

        let result = crate::postgres::query_index::query_index(
            &mut transaction,
            &system,
            polycentric_protocol::model::known_message_types::POST,
            4,
            &None,
            &Some(vec![]),
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

        let s1 = polycentric_protocol::test_utils::make_test_keypair();
        let s1p1 = polycentric_protocol::test_utils::make_test_process();

        let s1p1e1 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 1, 12,
            );
        let s1p1e2 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 2, 13,
            );
        let s1p1e3 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 3, 14,
            );
        let s1p1e4 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 4, 15,
            );
        let s1p1e5 =
            polycentric_protocol::test_utils::make_test_event_with_time(
                &s1, &s1p1, 5, 20,
            );

        let s1p1e6 =
            polycentric_protocol::test_utils::make_delete_event_from_event(
                &s1, &s1p1, &s1p1e3, 6, 21,
            );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e3).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e4).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e5).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e6).await?;

        let s1_key = polycentric_protocol::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            1,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            2,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            3,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            4,
        )
        .await?;
        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            5,
        )
        .await?;

        crate::moderation::moderation_queue::approve_event(
            &mut transaction,
            &s1_key,
            &s1p1,
            6,
        )
        .await?;

        let system = polycentric_protocol::model::public_key::PublicKey::Ed25519(
            s1.verifying_key().clone(),
        );

        let result = crate::postgres::query_index::query_index(
            &mut transaction,
            &system,
            polycentric_protocol::model::known_message_types::POST,
            4,
            &None,
            &Some(vec![]),
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
