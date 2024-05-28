pub(crate) async fn upsert(
    transaction: &::deadpool_postgres::Transaction<'_>,
    handle: String,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO identity_handles (
            system_key_type,
            system_key,
            handle
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (
            system_key_type,
            system_key
        )
        DO UPDATE
        SET
            handle = $3
    ";

    let statement = transaction.prepare_cached(query).await?;

    transaction
        .query(
            &statement,
            &[
                &i64::try_from(crate::model::public_key::get_key_type(system))?,
                &crate::model::public_key::get_key_bytes(system),
                &handle,
            ],
        )
        .await?;

    Ok(())
}

pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    handle: String,
) -> ::anyhow::Result<crate::model::public_key::PublicKey> {
    let query = "
        SELECT
            system_key,
            system_key_type
        FROM
            identity_handles
        WHERE
            handle = $1;
    ";

    let statement = transaction.prepare_cached(query).await?;

    let row = transaction.query_one(&statement, &[&handle]).await?;

    let system_key_type: i64 = row.try_get(1)?;

    Ok(crate::model::public_key::from_type_and_bytes(
        u64::try_from(system_key_type)?,
        row.try_get(0)?,
    )?)
}
