pub(crate) async fn prepare_database(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::sqlx::Result<()> {
    ::sqlx::query(
        "
        DO $$ BEGIN
            CREATE TYPE pointer AS (
                public_key      BYTEA,
                writer_id       BYTEA,
                sequence_number INT8
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS events (
            author_public_key BYTEA NOT NULL,
            writer_id         BYTEA NOT NULL,
            sequence_number   INT8  NOT NULL,
            unix_milliseconds INT8  NOT NULL,
            content           BYTEA NOT NULL,
            signature         BYTEA NOT NULL,
            clocks            TEXT  NOT NULL,
            event_type        INT8  NOT NULL,
            mutation_pointer  pointer
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE UNIQUE INDEX IF NOT EXISTS events_index
        ON events (author_public_key, writer_id, sequence_number);
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS notifications (
            notification_id        INT8  NOT NULL,
            for_author_public_key  BYTEA NOT NULL,
            from_author_public_key BYTEA NOT NULL,
            from_writer_id         BYTEA NOT NULL,
            from_sequence_number   INT8  NOT NULL
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE UNIQUE INDEX IF NOT EXISTS notifications_index
        ON notifications (for_author_public_key, notification_id);
    ",
    )
    .execute(&mut *transaction)
    .await?;

    Ok(())
}

#[::sqlx::test]
async fn test_prepare_database(pool: ::sqlx::PgPool) -> ::sqlx::Result<()> {
    let mut transaction = pool.begin().await?;
    prepare_database(&mut transaction).await?;
    transaction.commit().await?;
    Ok(())
}
