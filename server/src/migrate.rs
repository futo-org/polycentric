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

            crate::queries::update_counts::update_counts(
                transaction,
                &event,
                &content,
            )
            .await?;

            crate::queries::update_counts::update_lww_element_reference(
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
