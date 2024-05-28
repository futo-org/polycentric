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
