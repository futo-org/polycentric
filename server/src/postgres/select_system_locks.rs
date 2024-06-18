use ::std::collections::HashMap;

pub(crate) async fn select(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: &HashMap<crate::model::InsecurePointer, crate::model::EventLayers>,
) -> ::anyhow::Result<()> {
    let query = "
        SELECT
            pg_advisory_xact_lock(
                ('x' || md5(p.system_key))::bit(64)::bigint
            )
        FROM (
            SELECT DISTINCT system_key
            FROM
                unnest(
                    $1::bytea []
                ) AS p (
                    system_key
                )
            ORDER BY system_key
        ) AS p
    ";

    let mut p_system_key = vec![];

    for layers in batch.values() {
        p_system_key.push(crate::model::public_key::get_key_bytes(
            layers.event().system(),
        ));
    }

    ::sqlx::query(query)
        .bind(p_system_key)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}
