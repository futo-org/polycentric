pub(crate) async fn execute(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<()> {
    Ok(transaction
        .batch_execute(::std::include_str!("../sql/schema.sql"))
        .await?)
}

