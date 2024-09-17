use crate::moderation::providers;
use protobuf::Message;

#[allow(dead_code)]
#[derive(::sqlx::FromRow, Debug)]
struct ModerationQueueRawRow {
    id: i64,
    raw_event: Vec<u8>,
}

#[derive(sqlx::Type, Debug)]
#[sqlx(type_name = "moderation_status_enum", rename_all = "snake_case")]
enum ModerationStatus {
    Pending,
    Processing,
    Approved,
    FlaggedAndRejected,
    Error,
}

pub struct ModerationQueueItem {
    // database id
    pub id: i64,
    pub content: Option<String>,
    pub blob: Option<Vec<u8>>,
}

async fn get_blob(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &crate::model::event::Event,
    post: &polycentric_protocol::protocol::Post,
) -> ::anyhow::Result<Vec<u8>> {
    let mut logical_clocks = vec![];
    for range in post.image.sections.iter() {
        let start = range.low;
        let end = range.high;
        for i in start..=end {
            logical_clocks.push(i);
        }
    }

    let query = "
    SELECT raw_event
    FROM events
    WHERE system_key_type = $1
    AND system_key = $2
    AND process = $3
    AND logical_clock = ANY($4)
    ORDER BY logical_clock ASC
    ";

    let system = event.system();
    let system_key_type =
        i64::try_from(crate::model::public_key::get_key_type(system))?;
    let system_key_bytes = crate::model::public_key::get_key_bytes(system);
    let process_bytes = event.process().bytes();
    let logical_clock_array: Vec<i64> = logical_clocks
        .into_iter()
        .map(|lc| i64::try_from(lc).unwrap())
        .collect();

    let rows: Vec<(Vec<u8>,)> = sqlx::query_as(query)
        .bind(system_key_type)
        .bind(system_key_bytes)
        .bind(process_bytes)
        .bind(&logical_clock_array)
        .fetch_all(&mut **transaction)
        .await?;

    // concat the sorted event.content() into a single buffer
    let mut blob = Vec::new();
    for (row,) in rows.iter() {
        blob.extend_from_slice(&row);
    }

    Ok(blob)
}

async fn pull_queue_events(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<Vec<ModerationQueueItem>> {
    const BATCH_SIZE: i64 = 20;

    let candidate_query = "
    SELECT e.id, e.raw_event,
           COALESCE(eps.failure_count, 0) AS failure_count,
           EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(eps.last_failure_at, '1970-01-01'::timestamp))) AS time_since_last_failure
    FROM events e
    LEFT JOIN event_processing_status eps ON e.id = eps.event_id
    WHERE (e.moderation_status = 'pending'
       OR (e.moderation_status = 'error' AND COALESCE(eps.failure_count, 0) < 3))
       AND e.content_type = 3
    ORDER BY 
        CASE 
            WHEN e.moderation_status = 'pending' THEN 0
            ELSE 1
        END,
        CASE 
            WHEN e.moderation_status = 'error' THEN 
                LEAST(COALESCE(eps.failure_count, 0) * COALESCE(eps.failure_count, 0) * 3600, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(eps.last_failure_at, '1970-01-01'::timestamp))))
            ELSE 0
        END DESC
    LIMIT $1
    ";

    let candidate_rows: Vec<ModerationQueueRawRow> =
        sqlx::query_as(candidate_query)
            .bind(BATCH_SIZE)
            .fetch_all(&mut **transaction)
            .await?;

    let candidate_ids: Vec<i64> =
        candidate_rows.iter().map(|row| row.id).collect();

    let update_events_query = "
        UPDATE events
        SET moderation_status = 'processing'
        WHERE id = ANY($1)
    ";
    sqlx::query(update_events_query)
        .bind(&candidate_ids)
        .execute(&mut **transaction)
        .await?;

    let upsert_processing_status_query = "
        INSERT INTO event_processing_status (event_id, processing_started_at)
        SELECT unnest($1::bigint[]), CURRENT_TIMESTAMP
        ON CONFLICT (event_id) DO UPDATE
        SET processing_started_at = CURRENT_TIMESTAMP
    ";
    sqlx::query(upsert_processing_status_query)
        .bind(&candidate_ids)
        .execute(&mut **transaction)
        .await?;

    let mut result_set = vec![];
    for row in candidate_rows.iter() {
        let signed_event =
            crate::model::signed_event::from_vec(&row.raw_event)?;
        let event = crate::model::event::from_vec(&signed_event.event())?;
        let post = polycentric_protocol::protocol::Post::parse_from_bytes(
            &event.content(),
        )?;

        let blob = match *event.content_type() {
            crate::model::known_message_types::POST => {
                get_blob(transaction, &event, &post).await?
            }
            _ => {
                return Err(::anyhow::anyhow!(
                    "Unsupported content type: {}",
                    event.content_type()
                ));
            }
        };

        result_set.push(ModerationQueueItem {
            id: row.id,
            content: post.content,
            blob: Some(blob),
        });
    }

    Ok(result_set)
}

#[derive(Clone)]
struct ModerationResult {
    event_id: i64,
    has_error: bool,
    is_csam: bool,
    tags: Vec<crate::model::moderation_tag::ModerationTag>,
}

async fn process(
    csam: &Box<dyn providers::csam::interface::ModerationCSAMProvider>,
    tag: &Option<
        Box<dyn providers::tags::interface::ModerationTaggingProvider>,
    >,
    events: &[ModerationQueueItem],
) -> ::anyhow::Result<Vec<ModerationResult>> {
    // create an static array of size events.len()
    let mut moderation_results = vec![
        ModerationResult {
            event_id: 0,
            has_error: false,
            is_csam: false,
            tags: vec![],
        };
        events.len()
    ];

    for (i, event) in events.iter().enumerate() {
        match tag {
            Some(tagger) => {
                let tagging_future = tagger.moderate(event);
                let csam_future = csam.moderate(event);
                let (tagging_result, csam_result) =
                    tokio::join!(tagging_future, csam_future);

                let has_error = tagging_result.is_err() || csam_result.is_err();

                let is_csam = match csam_result {
                    Ok(csam_result) => csam_result.is_csam,
                    Err(_) => false,
                };
                let tags = match tagging_result {
                    Ok(tagging_result) => tagging_result.tags,
                    Err(_) => vec![],
                };

                moderation_results[i] = ModerationResult {
                    event_id: event.id,
                    has_error,
                    tags,
                    is_csam,
                };
            }
            _ => {
                let csam_result = csam.moderate(event).await;

                let has_error = csam_result.is_err();
                let is_csam = match csam_result {
                    Ok(csam_result) => csam_result.is_csam,
                    Err(_) => false,
                };

                moderation_results[i] = ModerationResult {
                    event_id: event.id,
                    has_error,
                    tags: vec![],
                    is_csam,
                };
            }
        }
        // sleep for 250ms
        tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
    }

    return Ok(moderation_results);
}

async fn apply_moderation_results(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    results: &[ModerationResult],
) -> ::anyhow::Result<()> {
    for result in results.iter() {
        let event_id = result.event_id;
        let has_error = result.has_error;
        let is_csam = result.is_csam;

        let new_moderation_status = match (has_error, is_csam) {
            (true, _) => ModerationStatus::Error,
            (false, true) => ModerationStatus::FlaggedAndRejected,
            (false, false) => ModerationStatus::Approved,
        };

        let query = "
            UPDATE events
            SET moderation_status = $1, moderation_tags = $2::moderation_tag_type[]
            WHERE id = $3
        ";

        ::sqlx::query(query)
            .bind(new_moderation_status)
            .bind(&result.tags)
            .bind(event_id)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}

pub async fn run(
    pool: ::sqlx::PgPool,
    csam: Box<dyn providers::csam::interface::ModerationCSAMProvider>,
    tag: Option<Box<dyn providers::tags::interface::ModerationTaggingProvider>>,
) -> ::anyhow::Result<()> {
    // loop until task is cancelled
    loop {
        let mut transaction = pool.begin().await?;
        let events = pull_queue_events(&mut transaction).await?;
        transaction.commit().await?;

        let results = process(&csam, &tag, &events).await?;

        // separate transaction because this can take a while and we want to
        // avoid blocking other writes
        let mut transaction = pool.begin().await?;
        apply_moderation_results(&mut transaction, &results).await?;
        transaction.commit().await?;

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
}

#[allow(dead_code)]
pub async fn approve_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
) -> ::anyhow::Result<()> {
    let query = "
        UPDATE events
        SET moderation_status = 'approved'
        WHERE system_key_type = $1
        AND   system_key      = $2
        AND   process         = $3
        AND   logical_clock   = $4;
    ";

    ::sqlx::query(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .fetch_optional(&mut **transaction)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        model::moderation_tag::ModerationTagName,
        moderation::{ModerationFilter, ModerationOptions},
        postgres::prepare_database,
    };
    use sqlx::PgPool;

    #[sqlx::test]
    async fn test_pull_queue_events(pool: PgPool) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        prepare_database(&mut transaction).await?;

        let keypair = polycentric_protocol::test_utils::make_test_keypair();
        let process = polycentric_protocol::test_utils::make_test_process();

        let mut post = polycentric_protocol::protocol::Post::new();
        post.content = Some("test".to_string());
        // post.image = Some(crate::protocol::ImageManifest::new());
        // post.image.unwrap().sections.push(crate::protocol::ImageSection::new(1, 1));

        let signed_event =
            polycentric_protocol::test_utils::make_test_event_with_content(
                &keypair,
                &process,
                52,
                3,
                &post.write_to_bytes()?,
                vec![],
            );

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

        let events = pull_queue_events(&mut transaction).await?;

        transaction.commit().await?;

        assert!(Some(signed_event) == loaded_event);
        assert_eq!(events.len(), 1);

        Ok(())
    }

    #[sqlx::test]
    async fn test_apply_moderation_results(pool: PgPool) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        prepare_database(&mut transaction).await?;

        let mut constructed_events = vec![];
        for _ in 0..4 {
            let keypair = polycentric_protocol::test_utils::make_test_keypair();
            let process = polycentric_protocol::test_utils::make_test_process();

            let mut post = polycentric_protocol::protocol::Post::new();
            post.content = Some("test".to_string());

            let signed_event =
                polycentric_protocol::test_utils::make_test_event_with_content(
                    &keypair,
                    &process,
                    52,
                    3,
                    &post.write_to_bytes()?,
                    vec![],
                );

            crate::ingest::ingest_event_postgres(
                &mut transaction,
                &signed_event,
            )
            .await?;

            constructed_events.push(signed_event);
        }

        // Pull events from the moderation queue
        let events = pull_queue_events(&mut transaction).await?;

        // Mock moderation results
        let moderation_results = vec![
            ModerationResult {
                event_id: events[0].id,
                has_error: false,
                is_csam: false,
                tags: vec![],
            },
            ModerationResult {
                event_id: events[1].id,
                has_error: false,
                is_csam: true,
                tags: vec![],
            },
            ModerationResult {
                event_id: events[2].id,
                has_error: true,
                is_csam: false,
                tags: vec![],
            },
            ModerationResult {
                event_id: events[3].id,
                has_error: false,
                is_csam: false,
                tags: vec![
                    crate::model::moderation_tag::ModerationTag::new(
                        "tag1".to_string(),
                        1,
                    ),
                    crate::model::moderation_tag::ModerationTag::new(
                        "tag2".to_string(),
                        2,
                    ),
                ],
            },
        ];

        // Apply moderation results
        apply_moderation_results(&mut transaction, &moderation_results).await?;

        // Verify events after application
        for event in events.iter() {
            let query = "
                SELECT moderation_status::text
                FROM events
                WHERE id = $1
            ";

            let status_str: String = sqlx::query_scalar(query)
                .bind(event.id)
                .fetch_one(&mut *transaction)
                .await?;

            // find the moderation result for this event
            let moderation_result = moderation_results
                .iter()
                .find(|result| result.event_id == event.id);

            assert!(moderation_result.is_some());

            match (
                moderation_result.unwrap().has_error,
                moderation_result.unwrap().is_csam,
            ) {
                (true, _) => assert_eq!(status_str, "error"),
                (_, true) => assert_eq!(status_str, "flagged_and_rejected"),
                (false, false) => assert_eq!(status_str, "approved"),
            }

            let tags_query = "
                SELECT tag
                FROM events, unnest(moderation_tags) AS tag_item
                WHERE id = $1
            ";

            let tags: Vec<String> = sqlx::query_scalar(tags_query)
                .bind(event.id)
                .fetch_all(&mut *transaction)
                .await?;

            let expected_tags = moderation_result.unwrap().tags.clone();

            for expected_tag in expected_tags.iter() {
                assert!(tags.contains(&expected_tag.tag().to_string()));
            }
        }

        Ok(())
    }

    #[sqlx::test]
    async fn test_query_event_below_moderation_threshold_strict(
        pool: PgPool,
    ) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        prepare_database(&mut transaction).await?;

        let keypair = polycentric_protocol::test_utils::make_test_keypair();
        let process = polycentric_protocol::test_utils::make_test_process();

        let mut post = polycentric_protocol::protocol::Post::new();
        post.content = Some("test".to_string());

        let signed_event =
            polycentric_protocol::test_utils::make_test_event_with_content(
                &keypair,
                &process,
                52,
                3,
                &post.write_to_bytes()?,
                vec![],
            );

        crate::ingest::ingest_event_postgres(&mut transaction, &signed_event)
            .await?;

        let loaded_events = crate::postgres::load_posts_before_id(
            &mut transaction,
            100000,
            1,
            &Some(ModerationOptions(vec![ModerationFilter {
                tag: ModerationTagName::new(String::from("sexual")),
                max_level: 1,
                strict_mode: true,
            }])),
        )
        .await?;

        assert_eq!(loaded_events.events.len(), 0);

        Ok(())
    }

    #[sqlx::test]
    async fn test_moderation_filter_strict(pool: PgPool) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        prepare_database(&mut transaction).await?;

        // send a moderation filter with strict = true
        // return the filter's strict value

        let filter = ModerationFilter {
            tag: ModerationTagName::new(String::from("sexual")),
            max_level: 1,
            strict_mode: true,
        };

        let query = "
            SELECT strict_mode
            FROM unnest($1::moderation_filter_type[]) AS filter
            WHERE filter.tag = $2 AND filter.max_level = $3
        ";

        let result: bool = sqlx::query_scalar(query)
            .bind(&[filter.clone()])
            .bind(&filter.tag.to_string())
            .bind(filter.max_level)
            .fetch_one(&mut *transaction)
            .await?;

        assert_eq!(result, true);

        Ok(())
    }

    #[sqlx::test]
    async fn test_query_event_below_moderation_threshold_non_strict(
        pool: PgPool,
    ) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        prepare_database(&mut transaction).await?;

        let keypair = polycentric_protocol::test_utils::make_test_keypair();
        let process = polycentric_protocol::test_utils::make_test_process();

        let mut post = polycentric_protocol::protocol::Post::new();
        post.content = Some("test".to_string());

        let signed_event =
            polycentric_protocol::test_utils::make_test_event_with_content(
                &keypair,
                &process,
                52,
                3,
                &post.write_to_bytes()?,
                vec![],
            );

        crate::ingest::ingest_event_postgres(&mut transaction, &signed_event)
            .await?;

        // Don't load unapproved events
        let loaded_events = crate::postgres::load_posts_before_id(
            &mut transaction,
            100000,
            1,
            &Some(ModerationOptions(vec![ModerationFilter {
                tag: ModerationTagName::new(String::from("sexual")),
                max_level: 0,
                strict_mode: false,
            }])),
        )
        .await?;

        assert_eq!(loaded_events.events.len(), 0);

        let events = pull_queue_events(&mut transaction).await?;

        assert_eq!(events.len(), 1);

        let moderation_results = vec![ModerationResult {
            event_id: events[0].id,
            has_error: false,
            is_csam: false,
            tags: vec![crate::model::moderation_tag::ModerationTag::new(
                "sexual".to_string(),
                3,
            )],
        }];

        apply_moderation_results(&mut transaction, &moderation_results).await?;

        let loaded_events = crate::postgres::load_posts_before_id(
            &mut transaction,
            100000,
            1,
            &Some(ModerationOptions(vec![ModerationFilter {
                tag: ModerationTagName::new(String::from("sexual")),
                max_level: 0,
                strict_mode: false,
            }])),
        )
        .await?;

        assert_eq!(loaded_events.events.len(), 0);

        let loaded_events2 = crate::postgres::load_posts_before_id(
            &mut transaction,
            100000,
            1,
            &Some(ModerationOptions(vec![ModerationFilter {
                tag: ModerationTagName::new(String::from("sexual")),
                max_level: 3,
                strict_mode: false,
            }])),
        )
        .await?;

        assert_eq!(loaded_events2.events.len(), 1);

        let loaded_events_default = crate::postgres::load_posts_before_id(
            &mut transaction,
            100000,
            1,
            &None,
        )
        .await?;

        assert_eq!(loaded_events_default.events.len(), 0);

        Ok(())
    }

    #[sqlx::test]
    async fn test_above_threshold(pool: PgPool) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        prepare_database(&mut transaction).await?;

        let keypair = polycentric_protocol::test_utils::make_test_keypair();
        let process = polycentric_protocol::test_utils::make_test_process();

        let mut post = polycentric_protocol::protocol::Post::new();
        post.content = Some("test".to_string());

        let signed_event =
            polycentric_protocol::test_utils::make_test_event_with_content(
                &keypair,
                &process,
                52,
                3,
                &post.write_to_bytes()?,
                vec![],
            );

        crate::ingest::ingest_event_postgres(&mut transaction, &signed_event)
            .await?;

        let events = pull_queue_events(&mut transaction).await?;
        assert_eq!(events.len(), 1);

        let moderation_results = vec![ModerationResult {
            event_id: events[0].id,
            has_error: false,
            is_csam: false,
            tags: vec![crate::model::moderation_tag::ModerationTag::new(
                "violence".to_string(),
                3,
            )],
        }];

        apply_moderation_results(&mut transaction, &moderation_results).await?;

        let loaded_events = crate::postgres::load_posts_before_id(
            &mut transaction,
            100000,
            1,
            &Some(ModerationOptions(vec![ModerationFilter {
                tag: ModerationTagName::new(String::from("violence")),
                max_level: 1,
                strict_mode: false,
            }])),
        )
        .await?;

        assert_eq!(loaded_events.events.len(), 0);

        let loaded_events2 = crate::postgres::load_posts_before_id(
            &mut transaction,
            100000,
            1,
            &Some(ModerationOptions(vec![ModerationFilter {
                tag: ModerationTagName::new(String::from("sexual")),
                max_level: 1,
                strict_mode: false,
            }])),
        )
        .await?;

        assert_eq!(loaded_events2.events.len(), 1);

        Ok(())
    }
}
