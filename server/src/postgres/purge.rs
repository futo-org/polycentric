pub(crate) async fn purge(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
) -> ::anyhow::Result<()> {
    let query = "
        DELETE FROM events
        WHERE system_key_type = $1
        AND system_key = $2
    ";

    ::sqlx::query(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .execute(&mut **transaction)
        .await?;

    Ok(())
}
