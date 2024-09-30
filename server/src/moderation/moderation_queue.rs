use crate::moderation::providers;
use futures::stream::{self, StreamExt};
use protobuf::Message;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::time::{self, Duration};

use super::providers::csam::interface::ModerationCSAMResult;
use super::providers::tags::interface::ModerationTaggingResult;

#[allow(dead_code)]
struct RateLimiter {
    semaphore: Arc<Semaphore>,
    tokens_per_second: u16,
}

impl RateLimiter {
    fn new(max_tokens: u16, tokens_per_second: u16) -> Self {
        let semaphore = Arc::new(Semaphore::new(max_tokens as usize));
        let rate_limiter = RateLimiter {
            semaphore,
            tokens_per_second,
        };

        let semaphore_clone = Arc::clone(&rate_limiter.semaphore);
        tokio::spawn(async move {
            let interval_duration =
                Duration::from_secs_f64(1.0 / tokens_per_second as f64);
            let mut interval = time::interval(interval_duration);
            loop {
                interval.tick().await;
                semaphore_clone.add_permits(1);
            }
        });

        rate_limiter
    }

    async fn acquire(&self) {
        self.semaphore.acquire().await.unwrap().forget();
    }
}

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
        blob.extend_from_slice(row);
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
       AND e.content_type IN (3, 6, 9)
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
        let event = crate::model::event::from_vec(signed_event.event())?;
        let post = polycentric_protocol::protocol::Post::parse_from_bytes(
            event.content(),
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

async fn process_event(
    csam: Arc<&dyn providers::csam::interface::ModerationCSAMProvider>,
    tag: Option<Arc<&dyn providers::tags::interface::ModerationTaggingProvider>>,
    event: ModerationQueueItem,
    request_rate_limiter: Arc<&RateLimiter>,
) -> ModerationResult {
    // Acquire a permit from the rate limiter
    request_rate_limiter.acquire().await;

    let should_csam = event.blob.is_some();

    let tagging_future = match tag {
        Some(tag) => tag.moderate(&event),
        None => Box::pin(async { Ok(ModerationTaggingResult { tags: vec![] }) }),
    };

    let csam_future = if should_csam {
        csam.moderate(&event)
    } else {
        Box::pin(async { Ok(ModerationCSAMResult { is_csam: false }) })
    };

    let (tagging_result, csam_result) =
        tokio::join!(tagging_future, csam_future);

    let has_error = tagging_result.is_err() || csam_result.is_err();

    let is_csam = csam_result.as_ref().map_or(false, |res| res.is_csam);
    let tags = match tagging_result {
        Ok(result) => result.tags,
        Err(_) => vec![],
    };

    ModerationResult {
        event_id: event.id,
        has_error,
        tags,
        is_csam,
    }
    // }
}

async fn process(
    csam: &dyn providers::csam::interface::ModerationCSAMProvider,
    tag: Option<&dyn providers::tags::interface::ModerationTaggingProvider>,
    events: Vec<ModerationQueueItem>,
    request_rate_limiter: &RateLimiter,
) -> ::anyhow::Result<Vec<ModerationResult>> {
    // Define the maximum concurrency based on the rate limiter's tokens per second
    let max_concurrency = request_rate_limiter.tokens_per_second as usize;

    let csam_arc = Arc::new(csam);
    let tag_arc = tag.map(|t| Arc::new(t));
    let request_rate_limiter_arc = Arc::new(request_rate_limiter);

    let results = stream::iter(events.into_iter())
        .map(|event| {
            let csam_arc_clone = Arc::clone(&csam_arc);
            let tag_arc_clone = tag_arc.as_ref().map(Arc::clone);
            let request_rate_limiter_clone = Arc::clone(&request_rate_limiter_arc);

            async move {
                process_event(csam_arc_clone, tag_arc_clone, event, request_rate_limiter_clone)
                    .await
            }
        })
        .buffer_unordered(max_concurrency)
        .collect::<Vec<_>>()
        .await;

    Ok(results)
}

async fn apply_moderation_results(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    results: &[ModerationResult],
) -> ::anyhow::Result<()> {
    for result in results.iter() {
        let event_id = result.event_id;
        let has_error = result.has_error;
        let is_csam = result.is_csam;
        let has_any_over_level_2 =
            result.tags.iter().any(|tag| *tag.level() > 2);

        let new_moderation_status =
            match (has_error, is_csam, has_any_over_level_2) {
                (true, _, _) => ModerationStatus::Error,
                (false, true, _) => ModerationStatus::FlaggedAndRejected,
                (false, _, true) => ModerationStatus::FlaggedAndRejected,
                (false, false, false) => ModerationStatus::Approved,
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
    csam: &dyn providers::csam::interface::ModerationCSAMProvider,
    tag: Option<&dyn providers::tags::interface::ModerationTaggingProvider>,
    tagging_request_rate_limit: u16,
) -> ::anyhow::Result<()> {
    // loop until task is cancelled
    let request_rate_limiter = Arc::new(RateLimiter::new(
        tagging_request_rate_limit,
        tagging_request_rate_limit,
    ));
    loop {
        let mut transaction = pool.begin().await?;
        let events = pull_queue_events(&mut transaction).await?;
        transaction.commit().await?;

        let results =
            process(csam, tag, events, &request_rate_limiter).await?;

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
