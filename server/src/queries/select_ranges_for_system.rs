pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<crate::protocol::RangesForSystem> {
    let statement = transaction
        .prepare_cached(::std::include_str!(
            "../sql/select_ranges_for_system.sql"
        ))
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

    let mut result = crate::protocol::RangesForSystem::new();

    for row in rows {
        let process =
            ::protobuf::MessageField::some(crate::model::process::to_proto(
                &crate::model::process::from_vec(&row.try_get(0)?)?,
            ));

        let low: i64 = row.try_get(1)?;
        let high: i64 = row.try_get(2)?;

        let mut found: Option<&mut crate::protocol::RangesForProcess> = None;

        for ranges_for_process in result.ranges_for_processes.iter_mut() {
            if ranges_for_process.process == process {
                found = Some(ranges_for_process);

                break;
            }
        }

        let ranges_for_process = match found {
            Some(x) => x,
            None => {
                let mut next = crate::protocol::RangesForProcess::new();
                next.process = process;
                result.ranges_for_processes.push(next);
                result.ranges_for_processes.last_mut().unwrap()
            }
        };

        let mut range_proto = crate::protocol::Range::new();
        range_proto.low = u64::try_from(low)?;
        range_proto.high = u64::try_from(high)?;
        ranges_for_process.ranges.push(range_proto);
    }

    Ok(result)
}
