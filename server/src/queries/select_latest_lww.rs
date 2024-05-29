pub(crate) struct InputRow {
    pub(crate) system: crate::model::public_key::PublicKey,
    pub(crate) content_type: u64,
}

pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    input_rows: Vec<InputRow>,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let statement = transaction
        .prepare_cached(::std::include_str!("../sql/select_latest_lww.sql"))
        .await?;

    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_content_type = vec![];

    for input_row in input_rows.iter() {
        p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(&input_row.system),
        )?);

        p_system_key
            .push(crate::model::public_key::get_key_bytes(&input_row.system));

        p_content_type.push(i64::try_from(input_row.content_type)?);
    }

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
