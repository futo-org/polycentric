pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    system: &crate::model::public_key::PublicKey,
    content_types: &Vec<u64>,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_content_type = vec![];

    for content_type in content_types.iter() {
        p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(system),
        )?);
        p_system_key.push(crate::model::public_key::get_key_bytes(system));
        p_content_type.push(i64::try_from(*content_type)?);
    }

    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/select_latest.sql"))
        .await?;

    let rows = transaction
        .query(
            &statement,
            &[&p_system_key_type, &p_system_key, &p_content_type],
        )
        .await?;

    let mut result = vec![];

    for row in rows {
        result.push(crate::model::signed_event::from_vec(row.try_get(0)?)?);
    }

    Ok(result)
}
