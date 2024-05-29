use ::std::collections::HashMap;

pub(crate) async fn prepare(
    transaction: &::deadpool_postgres::Transaction<'_>,
) -> ::anyhow::Result<::tokio_postgres::Statement> {
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/select_system_lock.sql"))
        .await?;

    Ok(statement)
}

pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    batch: &HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
) -> ::anyhow::Result<()> {
    let statement = prepare(&transaction).await?;

    let mut p_system_key = vec![];

    for layers in batch.values() {
        p_system_key.push(crate::model::public_key::get_key_bytes(
            layers.event().system(),
        ));
    }

    transaction.query(&statement, &[&p_system_key]).await?;

    Ok(())
}
