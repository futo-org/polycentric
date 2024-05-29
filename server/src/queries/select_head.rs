pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/select_head.sql"))
        .await?;

    let rows = transaction
        .query(
            &statement,
            &[
                &i64::try_from(crate::model::public_key::get_key_type(system))?,
                &crate::model::public_key::get_key_bytes(system),
            ],
        )
        .await?;

    let mut result = vec![];

    for row in rows {
        result.push(crate::model::signed_event::from_vec(row.try_get(0)?)?);
    }

    Ok(result)
}
