use ::protobuf::Message;

pub(crate) async fn select(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    ranges: &polycentric_protocol::protocol::RangesForSystem,
) -> ::anyhow::Result<
    ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
> {
    let query = "
        WITH input_rows (
            system_key_type,
            system_key,
            process,
            low,
            high
        ) AS (
            SELECT
                *
             FROM
                UNNEST(
                    $1::bigint [],
                    $2::bytea [],
                    $3::bytea [],
                    $4::bigint [],
                    $5::bigint []
                ) AS p (
                    system_key_type,
                    system_key,
                    process,
                    low,
                    high
                )
        )

        SELECT
            raw_event
        FROM
            events
        INNER JOIN
            input_rows
            ON
                events.system_key_type = input_rows.system_key_type
            AND
                events.system_key = input_rows.system_key
            AND
                events.process = input_rows.process
        WHERE
            events.logical_clock >= input_rows.low
        AND
            events.logical_clock <= input_rows.high
    ";

    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_process = vec![];
    let mut p_low = vec![];
    let mut p_high = vec![];

    for process_ranges in ranges.ranges_for_processes.iter() {
        for range in process_ranges.ranges.iter() {
            p_system_key_type.push(i64::try_from(
                polycentric_protocol::model::public_key::get_key_type(system),
            )?);
            p_system_key.push(
                polycentric_protocol::model::public_key::get_key_bytes(system),
            );
            p_process.push(process_ranges.process.process.clone());
            p_low.push(i64::try_from(range.low)?);
            p_high.push(i64::try_from(range.high)?);
        }
    }

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(p_system_key_type)
        .bind(p_system_key)
        .bind(p_process)
        .bind(p_low)
        .bind(p_high)
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(|raw| {
            polycentric_protocol::model::signed_event::from_proto(
                &polycentric_protocol::protocol::SignedEvent::parse_from_bytes(
                    raw,
                )?,
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<
                polycentric_protocol::model::signed_event::SignedEvent,
            >,
        >>()
}
