use ::protobuf::Message;

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
                crate::model::signed_event::from_vec(&row.raw_event)?;

            let event = crate::model::event::from_vec(signed_event.event())?;

            let content = crate::model::content::decode_content(
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
            1 => break,
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
    let mut position = None;

    loop {
        ::log::info!("position: {:?}", position);

        let mut transaction = pool.begin().await?;

        let batch = crate::postgres::load_events_after_id(
            &mut transaction,
            &position,
            25,
        )
        .await?;

        transaction.commit().await?;

        if batch.cursor.is_none() {
            break;
        } else {
            position = batch.cursor;
        }

        for signed_event in batch.events {
            crate::ingest::ingest_event_search(
                &search,
                &crate::model::EventLayers::new(signed_event)?,
            )
            .await?;
        }
    }

    Ok(())
}

pub(crate) async fn backfill_remote_server(
    pool: ::sqlx::PgPool,
    address: String,
    starting_position: ::std::option::Option<u64>,
) -> ::anyhow::Result<()> {
    let http_client = ::reqwest::Client::new();

    {
        let response =
            http_client.get(address.clone() + "/version").send().await?;

        if response.status() != ::reqwest::StatusCode::OK {
            ::log::error!("invalid server");

            return Ok(());
        }
    }

    let mut position = starting_position;

    let http_concurrency = 20;

    let failed = ::std::sync::Arc::new(::tokio::sync::Mutex::new(false));
    let semaphore =
        ::std::sync::Arc::new(::tokio::sync::Semaphore::new(http_concurrency));

    loop {
        if *failed.lock().await {
            break;
        }

        ::log::info!("position: {:?}", position);

        let mut transaction = pool.begin().await?;

        let batch = crate::postgres::load_events_after_id(
            &mut transaction,
            &position,
            50,
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
            batch_proto
                .events
                .push(crate::model::signed_event::to_proto(event));
        }

        let failed = failed.clone();
        let address = address.clone();
        let batch_bytes = batch_proto.write_to_bytes()?;
        let http_client = http_client.clone();

        let semaphore = ::std::sync::Arc::clone(&semaphore);
        let permit = semaphore.acquire_owned().await?;

        if *failed.lock().await {
            break;
        }

        ::tokio::spawn(async move {
            let _permit = permit;

            let op = || async {
                let result = http_client
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
    }

    Ok(())
}
