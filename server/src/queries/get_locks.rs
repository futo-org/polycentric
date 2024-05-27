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

pub(crate) async fn get_locks(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: &mut HashMap<
        crate::model::InsecurePointer,
        crate::model::EventLayers,
    >,
) -> ::anyhow::Result<()> {
    let query = "
        SELECT pg_advisory_xact_lock(
            ('x' || md5(p.system_key))::bit(64)::bigint
        )
        FROM (
            SELECT
                DISTINCT system_key
            FROM UNNEST (
                $1
            ) as p (
                system_key
            )
            ORDER BY system_key
        ) as p
    ";

    let mut p_system_key = vec![];

    for layers in batch.values() {
        p_system_key.push(crate::model::public_key::get_key_bytes(
            layers.event().system(),
        ));
    }

    if p_system_key.len() != 0 {
        ::sqlx::query(query)
            .bind(p_system_key)
            .execute(&mut **transaction)
            .await?;
    }

    Ok(())
}
