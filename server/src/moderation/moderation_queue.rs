use crate::moderation::providers;
use futures::stream::{self, StreamExt};
use log::debug;
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
        debug!("Creating new RateLimiter with max_tokens: {}, tokens_per_second: {}", max_tokens, tokens_per_second);
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
        debug!("Acquiring permit from RateLimiter");
        self.semaphore.acquire().await.unwrap().forget();
    }
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow, Debug)]
struct ModerationQueueRawRow {
    id: i64,
    raw_event: Vec<u8>,
}

#[derive(sqlx::Type, Debug, PartialEq)]
#[sqlx(type_name = "moderation_status_enum", rename_all = "snake_case")]
enum ModerationStatus {
    Unprocessed,
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
    pub blob_db_ids: Option<Vec<i64>>,
}

async fn get_blob(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &crate::model::event::Event,
    post: &polycentric_protocol::protocol::Post,
) -> ::anyhow::Result<(Vec<u8>, Vec<i64>)> {
    debug!("Getting blob for event");
    let mut logical_clocks = vec![];
    // Check if post has image field (single image support)
    if let Some(image) = post.image.as_ref() {
        for range in image.sections.iter() {
            let start = range.low;
            let end = range.high;
            for i in start..=end {
                logical_clocks.push(i);
            }
        }
    }

    let query = "
    SELECT content, id
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

    let rows: Vec<(Vec<u8>, i64)> = sqlx::query_as(query)
        .bind(system_key_type)
        .bind(system_key_bytes)
        .bind(process_bytes)
        .bind(&logical_clock_array)
        .fetch_all(&mut **transaction)
        .await?;

    // concat the sorted event.content() into a single buffer
    let mut blob = Vec::new();
    let mut blob_db_ids = Vec::new();
    for (row, id) in rows.iter() {
        blob.extend_from_slice(row);
        blob_db_ids.push(*id);
    }

    debug!(
        "Blob retrieved successfully for event: {:?}",
        event.logical_clock()
    );
    Ok((blob, blob_db_ids))
}

async fn get_blob_by_logical_clocks(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &crate::model::event::Event,
    logical_clocks: &[u64],
) -> ::anyhow::Result<(Vec<u8>, Vec<i64>)> {
    if logical_clocks.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let query = "
        SELECT content, id
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
        .iter()
        .map(|lc| i64::try_from(*lc).unwrap())
        .collect();

    let rows: Vec<(Vec<u8>, i64)> = ::sqlx::query_as(query)
        .bind(system_key_type)
        .bind(system_key_bytes)
        .bind(process_bytes)
        .bind(&logical_clock_array)
        .fetch_all(&mut **transaction)
        .await?;

    let mut blob = Vec::new();
    let mut blob_db_ids = Vec::new();
    for (row, id) in rows.iter() {
        blob.extend_from_slice(row);
        blob_db_ids.push(*id);
    }
    Ok((blob, blob_db_ids))
}

async fn pull_queue_events(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<Vec<ModerationQueueItem>> {
    debug!("Pulling queue events");

    let query = "
    SELECT 
        e.id,
        e.raw_event,
        COALESCE(eps.failure_count, 0) as failure_count,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(eps.last_failure_at, '1970-01-01'::timestamp))) as time_since_last_failure
    FROM events e
    LEFT JOIN LATERAL (
        SELECT event_id, failure_count, last_failure_at
        FROM event_processing_status
        WHERE event_id = e.id
        AND failure_count < 3
    ) eps ON true
    WHERE e.content_type IN (3, 6, 9)
    AND e.moderation_status IN ('unprocessed'::moderation_status_enum, 'error'::moderation_status_enum)
    ORDER BY 
        CASE WHEN e.moderation_status = 'unprocessed'::moderation_status_enum THEN 0 ELSE 1 END,
        COALESCE(eps.failure_count, 0) DESC
    LIMIT 20
    ";

    let candidate_rows: Vec<ModerationQueueRawRow> =
        sqlx::query_as(query).fetch_all(&mut **transaction).await?;

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

        use polycentric_protocol::model::known_message_types as ct;

        match *event.content_type() {
            ct::POST => {
                // Standard post parsing (existing behaviour)
                let post =
                    polycentric_protocol::protocol::Post::parse_from_bytes(
                        event.content(),
                    )?;

                // Retrieve the blob bytes for this post (if any), but only
                // include them in the queue item when we actually have data.
                let (blob, blob_db_ids) = if post
                    .image
                    .as_ref()
                    .map_or(true, |img| img.sections.is_empty())
                {
                    (None, None)
                } else {
                    let (blob, blob_db_ids) =
                        get_blob(transaction, &event, &post).await?;

                    // Skip if the blob is empty, too large, or too small for Azure
                    if blob.is_empty() || blob.len() > 4 * 1024 * 1024 {
                        debug!("Skipping POST event {} - blob empty or too large ({} bytes)", row.id, blob.len());
                        (None, None)
                    } else {
                        // Check if image is too small for Azure (minimum 50px width)
                        // This is a basic check - we assume most small images are icons/avatars that are too small
                        if blob.len() < 1000 {
                            // Very small blobs are likely too small for Azure's 50px minimum
                            debug!("Skipping POST event {} - blob likely too small for Azure ({} bytes)", row.id, blob.len());
                            (None, None)
                        } else {
                            debug!(
                                "POST event {} has valid blob: {} bytes",
                                row.id,
                                blob.len()
                            );
                            (Some(blob), Some(blob_db_ids))
                        }
                    }
                };

                // Only create queue item if we have content or a valid blob
                let has_content = post.content.is_some()
                    && !post.content.as_ref().unwrap().trim().is_empty();
                let has_blob = blob.is_some();

                if has_content || has_blob {
                    debug!("Creating POST queue item: id={}, has_content={}, has_blob={}", row.id, has_content, has_blob);
                    result_set.push(ModerationQueueItem {
                        id: row.id,
                        content: post.content,
                        blob,
                        blob_db_ids,
                    });
                } else {
                    debug!(
                        "Skipping POST event {} - no content or blob",
                        row.id
                    );
                }
            }
            ct::DESCRIPTION => {
                // DESCRIPTION uses LWW element for text
                let text_content = event
                    .lww_element()
                    .as_ref()
                    .and_then(|lww| String::from_utf8(lww.value.clone()).ok());

                // Only create queue item if we have valid text content
                if let Some(content) = text_content {
                    if !content.trim().is_empty() {
                        debug!("Creating DESCRIPTION queue item: id={}, content_len={}", row.id, content.len());
                        result_set.push(ModerationQueueItem {
                            id: row.id,
                            content: Some(content),
                            blob: None,
                            blob_db_ids: None,
                        });
                    } else {
                        debug!("Skipping DESCRIPTION event {} - empty content after trim", row.id);
                    }
                } else {
                    debug!("Skipping DESCRIPTION event {} - no valid UTF-8 content", row.id);
                }
            }
            ct::AVATAR => {
                // Avatar references blob sections via indices with index_type == BLOB_SECTION
                // For avatars, we need to get the ImageBundle first to find the largest resolution
                let avatar_bundle = if let Some(lww) = event.lww_element() {
                    match polycentric_protocol::protocol::ImageBundle::parse_from_bytes(&lww.value) {
                        Ok(bundle) => Some(bundle),
                        Err(e) => {
                            debug!("Failed to parse avatar bundle for event {}: {}", row.id, e);
                            None
                        }
                    }
                } else {
                    debug!("AVATAR event {} has no LWW element", row.id);
                    None
                };

                let (blob, blob_db_ids) = if let Some(bundle) = avatar_bundle {
                    // Find the largest available avatar resolution (prefer 256x256, then 128x128, then 32x32)
                    let largest_manifest = bundle
                        .image_manifests
                        .iter()
                        .max_by_key(|manifest| manifest.width);

                    if let Some(manifest) = largest_manifest {
                        if manifest.process.as_ref().is_some() {
                            let logical_clocks: Vec<u64> = manifest
                                .sections
                                .iter()
                                .flat_map(|range| range.low..=range.high)
                                .collect();

                            if logical_clocks.is_empty() {
                                debug!("AVATAR event {} - no logical clocks in manifest", row.id);
                                (None, None)
                            } else {
                                let (blob, blob_db_ids) =
                                    get_blob_by_logical_clocks(
                                        transaction,
                                        &event,
                                        &logical_clocks,
                                    )
                                    .await?;

                                // Skip if the blob is empty or too large for Azure
                                if blob.is_empty()
                                    || blob.len() > 4 * 1024 * 1024
                                {
                                    debug!("Skipping AVATAR event {} - blob empty or too large ({} bytes)", row.id, blob.len());
                                    (None, None)
                                } else {
                                    debug!(
                                        "AVATAR event {} has valid blob: {} bytes ({}x{} resolution)",
                                        row.id,
                                        blob.len(),
                                        manifest.width,
                                        manifest.height
                                    );
                                    (Some(blob), Some(blob_db_ids))
                                }
                            }
                        } else {
                            debug!(
                                "AVATAR event {} - manifest has no process",
                                row.id
                            );
                            (None, None)
                        }
                    } else {
                        debug!(
                            "AVATAR event {} - no image manifests found",
                            row.id
                        );
                        (None, None)
                    }
                } else {
                    debug!("AVATAR event {} - no valid avatar bundle", row.id);
                    (None, None)
                };

                // Only create queue item if we have a valid blob
                if blob.is_some() {
                    debug!("Creating AVATAR queue item: id={}", row.id);
                    result_set.push(ModerationQueueItem {
                        id: row.id,
                        content: None,
                        blob,
                        blob_db_ids,
                    });
                } else {
                    debug!("Skipping AVATAR event {} - no valid blob", row.id);
                }
            }
            _ => {
                // Unsupported type – skip moderation
                result_set.push(ModerationQueueItem {
                    id: row.id,
                    content: None,
                    blob: None,
                    blob_db_ids: None,
                });
            }
        }
    }

    debug!("Queue events pulled successfully");
    Ok(result_set)
}

#[derive(Clone)]
struct ModerationResult {
    event_id: i64,
    has_error: bool,
    is_csam: bool,
    tags: Vec<crate::model::moderation_tag::ModerationTag>,
    blob_db_ids: Option<Vec<i64>>,
}

async fn tag_event(
    tag: &dyn providers::tags::interface::ModerationTaggingProvider,
    event: &ModerationQueueItem,
    request_rate_limiter: &RateLimiter,
) -> anyhow::Result<ModerationTaggingResult> {
    debug!("Tagging event: {:?}", event.id);
    request_rate_limiter.acquire().await;
    tag.moderate(event).await
}

async fn csam_detect_event(
    csam: &dyn providers::csam::interface::ModerationCSAMProvider,
    event: &ModerationQueueItem,
    request_rate_limiter: &RateLimiter,
) -> anyhow::Result<ModerationCSAMResult> {
    debug!("Detecting CSAM for event: {:?}", event.id);
    request_rate_limiter.acquire().await;
    csam.moderate(event).await
}

async fn process_event(
    csam: Option<&dyn providers::csam::interface::ModerationCSAMProvider>,
    tag: Option<&dyn providers::tags::interface::ModerationTaggingProvider>,
    event: &ModerationQueueItem,
    request_rate_limiter: &RateLimiter,
    csam_request_rate_limiter: &RateLimiter,
) -> ModerationResult {
    debug!(
        "Processing event: {:?}, has_content={}, has_blob={}",
        event.id,
        event.content.is_some(),
        event.blob.is_some()
    );

    // Acquire a permit from the rate limiter

    let should_csam = event.blob.is_some() && csam.is_some();

    // It's written like this so we can do a join if we need to do both
    // Can't join on None
    let (tagging_result, csam_result) = match (tag, should_csam) {
        (Some(tag), true) => {
            debug!("Event {}: Running both tagging and CSAM", event.id);
            let tagging_future = tag_event(tag, event, request_rate_limiter);
            let csam_future = csam_detect_event(
                csam.unwrap(),
                event,
                csam_request_rate_limiter,
            );
            let (tagging_result, csam_result) =
                tokio::join!(tagging_future, csam_future);
            (Some(tagging_result), Some(csam_result))
        }
        (Some(tag), false) => {
            debug!("Event {}: Running tagging only", event.id);
            (
                Some(tag_event(tag, event, request_rate_limiter).await),
                None,
            )
        }
        (None, true) => {
            debug!("Event {}: Running CSAM only", event.id);
            (
                None,
                Some(
                    csam_detect_event(
                        csam.unwrap(),
                        event,
                        csam_request_rate_limiter,
                    )
                    .await,
                ),
            )
        }
        (None, false) => {
            debug!("Event {}: No moderation providers available", event.id);
            (None, None)
        }
    };

    let mut has_error = false;

    let is_csam = match csam_result {
        Some(ref result) => match result {
            Ok(result) => result.is_csam,
            Err(e) => {
                debug!("CSAM error for event: {:?}, error: {:?}", event.id, e);
                has_error = true;
                false
            }
        },
        None => false,
    };

    let tags = match tagging_result {
        Some(ref result) => match result {
            Ok(result) => {
                debug!(
                    "Event {}: Tagging successful, {} tags",
                    event.id,
                    result.tags.len()
                );
                result.tags.clone()
            }
            Err(e) => {
                debug!(
                    "Tagging error for event: {:?}, error: {:?}",
                    event.id, e
                );
                has_error = true;
                Vec::new()
            }
        },
        None => Vec::new(),
    };

    debug!(
        "Event {} processed: has_error={}, is_csam={}, tags_count={}",
        event.id,
        has_error,
        is_csam,
        tags.len()
    );
    ModerationResult {
        event_id: event.id,
        has_error,
        tags: tags.clone(),
        blob_db_ids: event.blob_db_ids.clone(),
        is_csam,
    }
    // }
}

async fn process(
    csam: Option<&dyn providers::csam::interface::ModerationCSAMProvider>,
    tag: Option<&dyn providers::tags::interface::ModerationTaggingProvider>,
    events: Vec<ModerationQueueItem>,
    request_rate_limiter: &RateLimiter,
    csam_request_rate_limiter: &RateLimiter,
) -> ::anyhow::Result<Vec<ModerationResult>> {
    debug!("Starting process for events");
    // Define the maximum concurrency based on the rate limiter's tokens per second
    let max_concurrency = 10;

    let results = stream::iter(events.into_iter())
        .map(|event| async move {
            process_event(
                csam,
                tag,
                &event,
                request_rate_limiter,
                csam_request_rate_limiter,
            )
            .await
        })
        .buffer_unordered(max_concurrency)
        .collect::<Vec<_>>()
        .await;

    debug!("Process completed for events");
    Ok(results)
}

async fn apply_moderation_results(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    results: &[ModerationResult],
) -> ::anyhow::Result<()> {
    debug!("Applying moderation results");
    for result in results.iter() {
        let event_id = result.event_id;
        let has_error = result.has_error;
        let is_csam = result.is_csam;

        let new_moderation_status = match (has_error, is_csam) {
            (false, true) => ModerationStatus::FlaggedAndRejected,
            (true, _) => ModerationStatus::Error,
            (false, false) => ModerationStatus::Approved,
        };

        match new_moderation_status {
            ModerationStatus::FlaggedAndRejected => {
                // Purge the really bad blobs
                if let Some(blob_db_ids) = &result.blob_db_ids {
                    let delete_blob_query = "
                        DELETE FROM blobs
                        WHERE id = ANY($1)
                    ";
                    ::sqlx::query(delete_blob_query)
                        .bind(blob_db_ids)
                        .execute(&mut **transaction)
                        .await?;
                }

                let delete_event_query = "
                    DELETE FROM events
                    WHERE id = $1
                ";

                ::sqlx::query(delete_event_query)
                    .bind(event_id)
                    .execute(&mut **transaction)
                    .await?;
            }
            ModerationStatus::Error => {
                let increment_failure_query = "
                    UPDATE event_processing_status
                    SET failure_count = failure_count + 1, last_failure_at = CURRENT_TIMESTAMP
                    WHERE event_id = $1
                ";

                ::sqlx::query(increment_failure_query)
                    .bind(event_id)
                    .execute(&mut **transaction)
                    .await?;

                let update_query = "
                    UPDATE events
                    SET moderation_status = $1
                    WHERE id = $2
                ";

                ::sqlx::query(update_query)
                    .bind(ModerationStatus::Error)
                    .bind(event_id)
                    .execute(&mut **transaction)
                    .await?;
            }
            ModerationStatus::Approved => {
                let update_query = "
                    UPDATE events
                    SET moderation_status = $1, moderation_tags = $2::moderation_tag_type[]
                    WHERE id = $3
                ";

                ::sqlx::query(update_query)
                    .bind(ModerationStatus::Approved)
                    .bind(&result.tags)
                    .bind(event_id)
                    .execute(&mut **transaction)
                    .await?;

                let delete_processing_status_query = "
                    DELETE FROM event_processing_status
                    WHERE event_id = $1
                ";

                ::sqlx::query(delete_processing_status_query)
                    .bind(event_id)
                    .execute(&mut **transaction)
                    .await?;
            }
            _ => {}
        }
    }

    debug!("Moderation results applied successfully");
    Ok(())
}

pub async fn run(
    pool: ::sqlx::PgPool,
    csam: Option<&dyn providers::csam::interface::ModerationCSAMProvider>,
    tag: Option<&dyn providers::tags::interface::ModerationTaggingProvider>,
    tagging_request_rate_limit: u16,
    csam_request_rate_limit: u16,
) -> ::anyhow::Result<()> {
    debug!("Starting run function");
    // loop until task is cancelled
    let request_rate_limiter = RateLimiter::new(
        tagging_request_rate_limit,
        tagging_request_rate_limit,
    );

    let csam_request_rate_limiter =
        RateLimiter::new(csam_request_rate_limit, csam_request_rate_limit);

    loop {
        let mut transaction = pool.begin().await?;
        let events = pull_queue_events(&mut transaction).await?;
        transaction.commit().await?;

        if events.is_empty() {
            debug!("No events to moderate, sleeping for 1 second");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }

        let results = process(
            csam,
            tag,
            events,
            &request_rate_limiter,
            &csam_request_rate_limiter,
        )
        .await?;

        // separate transaction because this can take a while and we want to
        // avoid blocking other writes
        let mut transaction = pool.begin().await?;
        apply_moderation_results(&mut transaction, &results).await?;
        transaction.commit().await?;
    }
}

#[allow(dead_code)]
pub async fn approve_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
) -> ::anyhow::Result<()> {
    debug!("Approving event with logical_clock: {}", logical_clock);
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

    debug!(
        "Event approved successfully with logical_clock: {}",
        logical_clock
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::ModerationMode,
        model::moderation_tag::ModerationTagName,
        moderation::{ModerationFilter, ModerationFilters, ModerationOptions},
        postgres::prepare_database,
    };
    use sqlx::PgPool;
    use std::time::Instant;

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
            keypair.verifying_key(),
        );

        let loaded_event = crate::postgres::load_event(
            &mut transaction,
            &system,
            &process,
            52,
            &crate::moderation::ModerationOptions {
                filters: None,
                mode: ModerationMode::Off,
            },
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
        for _ in 0..5 {
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
                blob_db_ids: None,
            },
            ModerationResult {
                event_id: events[1].id,
                has_error: false,
                is_csam: true,
                tags: vec![],
                blob_db_ids: None,
            },
            ModerationResult {
                event_id: events[2].id,
                has_error: true,
                is_csam: false,
                tags: vec![],
                blob_db_ids: None,
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
                blob_db_ids: None,
            },
            // tags of 3 should be deleted
            ModerationResult {
                event_id: events[4].id,
                has_error: false,
                is_csam: false,
                tags: vec![crate::model::moderation_tag::ModerationTag::new(
                    "anything".to_string(),
                    3,
                )],
                blob_db_ids: None,
            },
        ];

        // Apply moderation results
        apply_moderation_results(&mut transaction, &moderation_results).await?;

        transaction.commit().await?;
        transaction = pool.begin().await?;

        let mut has_success = false;

        // Verify events after application
        for event in events.iter() {
            let query = "
                SELECT moderation_status::text
                FROM events
                WHERE id = $1
            ";

            let status_str: Option<String> = sqlx::query_scalar(query)
                .bind(event.id)
                .fetch_optional(&mut *transaction)
                .await?;

            // If the event was deleted, skip the rest of the loop
            if status_str.is_none() {
                assert!(event.id == events[1].id || event.id == events[4].id);
                continue;
            }

            let status_str = status_str.unwrap();

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
                (false, false) => {
                    assert_eq!(status_str, "approved");
                    has_success = true;
                }
            }

            let tags_query = "
                SELECT name
                FROM events, unnest(moderation_tags) AS tag_item
                WHERE id = $1
            ";

            let tags: Vec<String> = sqlx::query_scalar(tags_query)
                .bind(event.id)
                .fetch_all(&mut *transaction)
                .await?;

            let expected_tags = moderation_result.unwrap().tags.clone();

            for expected_tag in expected_tags.iter() {
                assert!(tags.contains(&expected_tag.name().to_string()));
            }
        }

        assert!(has_success);

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

        println!("test_query_event_below_moderation_threshold_strict: ingesting event");

        crate::ingest::ingest_event_postgres(&mut transaction, &signed_event)
            .await?;

        transaction.commit().await?;
        transaction = pool.begin().await?;

        println!("test_query_event_below_moderation_threshold_strict: loading events");

        let loaded_events = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: Some(ModerationFilters(vec![ModerationFilter {
                    name: ModerationTagName::new(String::from("sexual")),
                    max_level: 1,
                    strict_mode: true,
                }])),
                mode: ModerationMode::Strong,
            },
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
            name: ModerationTagName::new(String::from("sexual")),
            max_level: 1,
            strict_mode: true,
        };

        let query = "
            SELECT strict_mode
            FROM unnest($1::moderation_filter_type[]) AS filter
            WHERE filter.name = $2 AND filter.max_level = $3
        ";

        let result: bool = sqlx::query_scalar(query)
            .bind(&[filter.clone()])
            .bind(&filter.name.to_string())
            .bind(filter.max_level)
            .fetch_one(&mut *transaction)
            .await?;

        assert!(result);

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

        transaction.commit().await?;
        transaction = pool.begin().await?;

        // Don't load unapproved events
        let loaded_events = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: Some(ModerationFilters(vec![ModerationFilter {
                    name: ModerationTagName::new(String::from("sexual")),
                    max_level: 0,
                    strict_mode: false,
                }])),
                mode: ModerationMode::Strong,
            },
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
                2,
            )],
            blob_db_ids: None,
        }];

        apply_moderation_results(&mut transaction, &moderation_results).await?;

        transaction.commit().await?;
        transaction = pool.begin().await?;

        let loaded_events = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: Some(ModerationFilters(vec![ModerationFilter {
                    name: ModerationTagName::new(String::from("sexual")),
                    max_level: 0,
                    strict_mode: false,
                }])),
                mode: ModerationMode::Strong,
            },
        )
        .await?;

        assert_eq!(loaded_events.events.len(), 0);

        let loaded_events2 = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: Some(ModerationFilters(vec![
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("sexual")),
                        max_level: 3,
                        strict_mode: false,
                    },
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("hate")),
                        max_level: 3,
                        strict_mode: false,
                    },
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("violence")),
                        max_level: 3,
                        strict_mode: false,
                    },
                ])),
                mode: ModerationMode::Strong,
            },
        )
        .await?;

        assert_eq!(loaded_events2.events.len(), 1);

        let loaded_events_default = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: None,
                mode: ModerationMode::Strong,
            },
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

        transaction.commit().await?;
        transaction = pool.begin().await?;

        let events = pull_queue_events(&mut transaction).await?;
        assert_eq!(events.len(), 1);

        let moderation_results = vec![ModerationResult {
            event_id: events[0].id,
            has_error: false,
            is_csam: false,
            tags: vec![
                crate::model::moderation_tag::ModerationTag::new(
                    "violence".to_string(),
                    2,
                ),
                crate::model::moderation_tag::ModerationTag::new(
                    "hate".to_string(),
                    0,
                ),
                crate::model::moderation_tag::ModerationTag::new(
                    "sexual".to_string(),
                    0,
                ),
            ],
            blob_db_ids: None,
        }];

        apply_moderation_results(&mut transaction, &moderation_results).await?;
        transaction.commit().await?;
        transaction = pool.begin().await?;

        let loaded_events = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: Some(ModerationFilters(vec![
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("violence")),
                        max_level: 1,
                        strict_mode: false,
                    },
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("hate")),
                        max_level: 1,
                        strict_mode: false,
                    },
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("sexual")),
                        max_level: 1,
                        strict_mode: false,
                    },
                ])),
                mode: ModerationMode::Strong,
            },
        )
        .await?;

        assert_eq!(loaded_events.events.len(), 0);

        let loaded_events2 = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: Some(ModerationFilters(vec![
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("violence")),
                        max_level: 2,
                        strict_mode: false,
                    },
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("hate")),
                        max_level: 1,
                        strict_mode: false,
                    },
                    ModerationFilter {
                        name: ModerationTagName::new(String::from("sexual")),
                        max_level: 1,
                        strict_mode: false,
                    },
                ])),
                mode: ModerationMode::Strong,
            },
        )
        .await?;

        assert_eq!(loaded_events2.events.len(), 1);

        Ok(())
    }

    #[sqlx::test]
    async fn test_moderation_modes(pool: PgPool) -> anyhow::Result<()> {
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

        transaction.commit().await?;
        transaction = pool.begin().await?;

        // In weak mode, events should be visible while we wait for moderation
        let loaded_events_weak = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: Some(ModerationFilters(vec![ModerationFilter {
                    name: ModerationTagName::new(String::from("violence")),
                    max_level: 3,
                    strict_mode: false,
                }])),
                mode: ModerationMode::Lazy,
            },
        )
        .await?;

        assert_eq!(loaded_events_weak.events.len(), 1);

        // In strong mode, events should not be visible until moderation is complete
        let loaded_events_strong = crate::postgres::load_posts_before_id(
            &mut transaction,
            None,
            100000,
            &ModerationOptions {
                filters: Some(ModerationFilters(vec![ModerationFilter {
                    name: ModerationTagName::new(String::from("violence")),
                    max_level: 3,
                    strict_mode: false,
                }])),
                mode: ModerationMode::Strong,
            },
        )
        .await?;

        assert_eq!(loaded_events_strong.events.len(), 0);

        Ok(())
    }

    #[sqlx::test]
    async fn test_explain_pull_queue_events(
        pool: PgPool,
    ) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        // First create some test data
        crate::postgres::prepare_database(&mut transaction).await?;

        // Add our performance improvements
        println!("\nAdding performance improvements...");

        // Add efficient index for events
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_events_moderation_efficient ON events 
             (moderation_status, content_type) 
             INCLUDE (id, raw_event)
             WHERE content_type IN (3, 6, 9)"
        )
        .execute(&mut *transaction)
        .await?;

        // Add enhanced index for event_processing_status
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_event_processing_enhanced ON event_processing_status 
             (failure_count) 
             INCLUDE (event_id, last_failure_at)
             WHERE failure_count < 3"
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        transaction = pool.begin().await?;

        // Test with different data sizes
        let data_sizes = vec![1000, 10000, 50000];

        for size in data_sizes {
            println!("\nTesting with {} records:", size);

            // Insert test data
            let start = Instant::now();
            for i in 0..size {
                let status = if i % 5 == 0 { "error" } else { "unprocessed" };
                let content_type = match i % 3 {
                    0 => 3,
                    1 => 6,
                    _ => 9,
                };

                // Insert event
                sqlx::query(
                    "INSERT INTO events (
                        system_key_type, system_key, process, logical_clock, 
                        content_type, content, vector_clock, indices,
                        signature, raw_event, server_time, unix_milliseconds,
                        moderation_status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::moderation_status_enum)"
                )
                .bind(1i64)
                .bind(&[0u8; 32])
                .bind(&[i as u8; 16])
                .bind(i64::try_from(i)?)
                .bind(content_type)
                .bind(&[0u8; 32])
                .bind(&[0u8; 32])
                .bind(&[0u8; 32])
                .bind(&[0u8; 32])
                .bind(&[0u8; 32])
                .bind(1000i64 + i64::try_from(i)?)
                .bind(1000i64 + i64::try_from(i)?)
                .bind(status)
                .execute(&mut *transaction)
                .await?;

                // Insert processing status for error events
                if status == "error" {
                    sqlx::query(
                        "INSERT INTO event_processing_status (
                            event_id, failure_count, last_failure_at
                        ) VALUES (
                            currval('events_id_seq'),
                            $1,
                            CURRENT_TIMESTAMP - interval '1 hour' * $2
                        )",
                    )
                    .bind(i % 4)
                    .bind(i % 12)
                    .execute(&mut *transaction)
                    .await?;
                }

                // Commit in batches to avoid transaction size issues
                if i > 0 && i % 1000 == 0 {
                    transaction.commit().await?;
                    transaction = pool.begin().await?;
                }
            }
            println!("Data insertion took: {:?}", start.elapsed());

            // Test the optimized query
            let query = "
                SELECT 
                    e.id,
                    e.raw_event,
                    COALESCE(eps.failure_count, 0) as failure_count,
                    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(eps.last_failure_at, '1970-01-01'::timestamp))) as time_since_last_failure
                FROM events e
                LEFT JOIN LATERAL (
                    SELECT event_id, failure_count, last_failure_at
                    FROM event_processing_status
                    WHERE event_id = e.id
                    AND failure_count < 3
                ) eps ON true
                WHERE e.content_type IN (3, 6, 9)
                AND e.moderation_status IN ('unprocessed'::moderation_status_enum, 'error'::moderation_status_enum)
                ORDER BY 
                    CASE WHEN e.moderation_status = 'unprocessed'::moderation_status_enum THEN 0 ELSE 1 END,
                    COALESCE(eps.failure_count, 0) DESC
                LIMIT 20
            ";

            let start = Instant::now();
            let results =
                sqlx::query(query).fetch_all(&mut *transaction).await?;
            println!("Query execution took: {:?}", start.elapsed());
            assert_eq!(results.len(), 20);

            // Clean up for next iteration
            sqlx::query("DELETE FROM event_processing_status")
                .execute(&mut *transaction)
                .await?;
            sqlx::query("DELETE FROM events")
                .execute(&mut *transaction)
                .await?;
            transaction.commit().await?;
            transaction = pool.begin().await?;
        }

        Ok(())
    }
}
