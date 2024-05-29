pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    system: &crate::model::public_key::PublicKey,
    ranges: &crate::protocol::RangesForSystem,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_process = vec![];
    let mut p_low = vec![];
    let mut p_high = vec![];

    for process_ranges in ranges.ranges_for_processes.iter() {
        for range in process_ranges.ranges.iter() {
            p_system_key_type.push(i64::try_from(
                crate::model::public_key::get_key_type(system),
            )?);
            p_system_key.push(crate::model::public_key::get_key_bytes(system));
            p_process.push(process_ranges.process.process.clone());
            p_low.push(i64::try_from(range.low)?);
            p_high.push(i64::try_from(range.high)?);
        }
    }

    let statement = transaction
        .prepare_cached(::std::include_str!(
            "../sql/select_events_by_ranges.sql"
        ))
        .await?;

    let rows = transaction
        .query(
            &statement,
            &[
                &p_system_key_type,
                &p_system_key,
                &p_process,
                &p_low,
                &p_high,
            ],
        )
        .await?;

    let mut result = vec![];

    for row in rows {
        result.push(crate::model::signed_event::from_vec(row.try_get(0)?)?);
    }

    Ok(result)
}
