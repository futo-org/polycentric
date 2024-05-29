pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    pointers: Vec<crate::model::pointer::Pointer>,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let statement = transaction
        .prepare_cached(::std::include_str!(
            "../sql/select_events_by_pointer.sql"
        ))
        .await?;

    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_process = vec![];
    let mut p_logical_clock = vec![];

    for pointer in pointers.iter() {
        p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(pointer.system()),
        )?);

        p_system_key
            .push(crate::model::public_key::get_key_bytes(pointer.system()));

        p_process.push(pointer.process().bytes());

        p_logical_clock.push(i64::try_from(*pointer.logical_clock())?);
    }

    let rows = transaction
        .query(
            &statement,
            &[
                &p_system_key_type,
                &p_system_key,
                &p_process,
                &p_logical_clock,
            ],
        )
        .await?;

    let mut result = vec![];

    for row in rows {
        result.push(crate::model::signed_event::from_vec(row.try_get(0)?)?);
    }

    Ok(result)
}
