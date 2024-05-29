pub(crate) async fn prepare(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let query = "
        DELETE FROM events
        WHERE system_key_type = $1
        AND system_key = $2
    ";

    Ok(transaction.prepare_cached(query).await?)
}

pub(crate) async fn purge(
    transaction: &::deadpool_postgres::Transaction<'_>,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<()> {
    let statement = prepare(&transaction).await?;

    transaction
        .query(
            &statement,
            &[
                &i64::try_from(crate::model::public_key::get_key_type(system))?,
                &crate::model::public_key::get_key_bytes(system),
            ],
        )
        .await?;

    Ok(())
}
