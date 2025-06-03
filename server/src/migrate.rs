use crate::cursor::ExploreCursor;
use crate::moderation::ModerationOptions;
use ::log::*;
use ::protobuf::Message;

const PAGE_SIZE: u64 = 20;

async fn load_version(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<i64> {
    Ok(
        ::sqlx::query_scalar::<_, i64>("SELECT version FROM schema_version")
            .fetch_one(&mut **transaction)
            .await?,
    )
}

async fn bump_version(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<()> {
    ::sqlx::query(
        "
        UPDATE schema_version
        SET version     = version + 1,
            upgraded_on = NOW();
    ",
    )
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

#[derive(::sqlx::FromRow)]
struct RawEventAndIdRow {
    id: i64,
    raw_event: ::std::vec::Vec<u8>,
}

async fn migration_1_compute_reference_counts(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<()> {
    ::log::info!("running migration_1_compute_reference_counts");

    let mut cursor: Option<i64> = None;

    loop {
        if let Some(position) = cursor {
            ::log::info!("cursor {:?}", position);
        }

        let rows = ::sqlx::query_as::<_, RawEventAndIdRow>(
            "
                SELECT id, raw_event FROM events
                WHERE ($1 IS NULL OR id > $1)
                ORDER BY id ASC
                LIMIT 100;
            ",
        )
        .bind(cursor)
        .fetch_all(&mut **transaction)
        .await?;

        if let Some(last_row) = rows.last() {
            cursor = Some(last_row.id);
        } else {
            return Ok(());
        }

        for row in rows.iter() {
            let signed_event =
                polycentric_protocol::model::signed_event::from_vec(
                    &row.raw_event,
                )?;

            let event = polycentric_protocol::model::event::from_vec(
                signed_event.event(),
            )?;

            let content = polycentric_protocol::model::content::decode_content(
                *event.content_type(),
                event.content(),
            )?;

            crate::postgres::update_counts::update_counts(
                transaction,
                &event,
                &content,
            )
            .await?;

            crate::postgres::update_counts::update_lww_element_reference(
                transaction,
                u64::try_from(row.id)?,
                &event,
            )
            .await?;
        }
    }
}

async fn migration_2_add_moderation_tags_cols(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<()> {
    ::log::info!("running migration_2_add_moderation_tags_cols");
    ::sqlx::query(
        "
        ALTER TABLE events
        ADD COLUMN IF NOT EXISTS moderation_status moderation_status_enum NOT NULL DEFAULT 'unprocessed',
        ADD COLUMN IF NOT EXISTS moderation_tags moderation_tag_type[];
        ",
    )
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

pub(crate) async fn migrate(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<()> {
    let mut current_version = load_version(transaction).await?;

    ::log::info!("current schema version: {}", current_version);

    loop {
        match current_version {
            0 => {
                migration_1_compute_reference_counts(&mut *transaction).await?
            }
            1 => {
                migration_2_add_moderation_tags_cols(&mut *transaction).await?
            }
            2 => break,
            _ => ::anyhow::bail!("schema too new for this server version"),
        }

        bump_version(transaction).await?;

        current_version += 1;
    }

    Ok(())
}

pub(crate) async fn backfill_search(
    pool: ::sqlx::PgPool,
    search: ::opensearch::OpenSearch,
) -> ::anyhow::Result<()> {
    let mut position: Option<ExploreCursor> = None;
    let mut total_processed: u64 = 0;

    info!("Starting search backfill");

    loop {
        info!("position: {:?}", position);

        let mut transaction = pool.begin().await?;

        let db_result = crate::postgres::load_events_after_id(
            &mut transaction,
            position,
            PAGE_SIZE,
            &ModerationOptions {
                filters: None,
                mode: crate::config::ModerationMode::Off,
            },
        )
        .await?;

        transaction.commit().await?;

        if db_result.cursor.is_none() {
            break;
        } else {
            position = db_result.cursor;
        }

        let num_events_in_batch = db_result.events.len() as u64;
        for signed_event in db_result.events {
            crate::ingest::ingest_event_search(
                &search,
                &polycentric_protocol::model::EventLayers::new(signed_event)?,
            )
            .await?;
        }
        total_processed += num_events_in_batch;
    }

    info!(
        "Search backfill completed. Processed {} events",
        total_processed
    );
    Ok(())
}

pub(crate) async fn backfill_remote_server(
    pool: ::sqlx::PgPool,
    address: String,
    starting_position: Option<ExploreCursor>,
) -> ::anyhow::Result<()> {
    info!(
        "Starting remote server backfill from {} at position {:?}",
        address,
        starting_position.map(|p| p.to_base64_str())
    );

    let mut position = starting_position;

    let client = ::reqwest::Client::new();

    {
        let response = client.get(address.clone() + "/version").send().await?;

        if response.status() != ::reqwest::StatusCode::OK {
            ::log::error!("invalid server");

            return Ok(());
        }
    }

    let http_concurrency = 20;

    let failed = ::std::sync::Arc::new(::tokio::sync::Mutex::new(false));
    let semaphore =
        ::std::sync::Arc::new(::tokio::sync::Semaphore::new(http_concurrency));

    loop {
        if *failed.lock().await {
            break;
        }

        info!("position: {:?}", position);

        let mut transaction = pool.begin().await?;

        let batch = crate::postgres::load_events_after_id(
            &mut transaction,
            position,
            50,
            &ModerationOptions {
                filters: None,
                mode: crate::config::ModerationMode::Off,
            },
        )
        .await?;

        transaction.commit().await?;

        if batch.cursor.is_none() {
            ::log::info!("no more events, waiting");

            ::tokio::time::sleep(::tokio::time::Duration::from_millis(5000))
                .await;

            continue;
        } else {
            position = batch.cursor;
        }

        let mut batch_proto = polycentric_protocol::protocol::Events::new();

        for event in batch.events.iter() {
            batch_proto.events.push(
                polycentric_protocol::model::signed_event::to_proto(event),
            );
        }

        let failed = failed.clone();
        let address = address.clone();
        let batch_bytes = batch_proto.write_to_bytes()?;
        let client = client.clone();

        let semaphore = ::std::sync::Arc::clone(&semaphore);
        let permit = semaphore.acquire_owned().await?;

        if *failed.lock().await {
            break;
        }

        ::tokio::spawn(async move {
            let _permit = permit;

            let op = || async {
                let result = client
                    .post(address.clone() + "/events")
                    .body(batch_bytes.clone())
                    .send()
                    .await;

                match result {
                    Ok(response) => {
                        if response.status()
                            == ::reqwest::StatusCode::BAD_REQUEST
                        {
                            Err(::backoff::Error::permanent(
                                ::anyhow::Error::msg("BAD_REQUEST"),
                            ))
                        } else if response.status() != ::reqwest::StatusCode::OK
                        {
                            ::log::warn!(
                                "temporary failure with status {:?}",
                                response.status(),
                            );

                            Err(::backoff::Error::transient(
                                ::anyhow::Error::msg("bad code"),
                            ))
                        } else {
                            Ok(())
                        }
                    }
                    Err(err) => Err(::backoff::Error::transient(
                        ::anyhow::Error::from(err),
                    )),
                }
            };

            let backoff = ::backoff::ExponentialBackoff::default();

            if let Err(err) = ::backoff::future::retry(backoff, op).await {
                ::log::error!("permanent failure with error {:?}", err);
                *failed.lock().await = true;
            }
        });

        info!(
            "Got {} events, new position: {:?}",
            batch.events.len(),
            position.map(|p| p.to_base64_str())
        );
    }

    Ok(())
}
