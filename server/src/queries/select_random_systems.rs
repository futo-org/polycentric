pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<Vec<crate::model::public_key::PublicKey>> {
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/select_random_systems.sql"))
        .await?;

    let rows = transaction.query(&statement, &[]).await?;

    let mut result = vec![];

    for row in rows {
        let system_key_type: i64 = row.try_get(1)?;

        result.push(crate::model::public_key::from_type_and_bytes(
            u64::try_from(system_key_type)?,
            row.try_get(0)?,
        )?);
    }

    Ok(result)
}
