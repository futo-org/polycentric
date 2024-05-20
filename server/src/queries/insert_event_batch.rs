use ::std::collections::HashMap;
use ::protobuf::Message;

pub(crate) struct EventLayersWithId {
    id: i64,
    layers: crate::model::EventLayers,
}

pub(crate) async fn insert_event_batch(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    batch: &mut HashMap<
        crate::model::InsecurePointer,
        crate::model::EventLayers,
    >,
    server_time: u64,
) -> ::anyhow::Result<()> {
    let query_insert_event = "
        INSERT INTO events
        (
            system_key_type,
            system_key,
            process,
            logical_clock,
            content_type,
            content,
            vector_clock,
            indices,
            signature,
            raw_event,
            server_time,
            unix_milliseconds
        )
        SELECT * FROM UNNEST (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        ) as p (
            system_key_type,
            system_key,
            process,
            logical_clock,
            content_type,
            content,
            vector_clock,
            indices,
            signature,
            raw_event,
            server_time,
            unix_milliseconds
        )
        WHERE NOT EXISTS
        AND
            system_key_type,
            system_key,
            process,
            logical_clock
        NOT IN (
            SELECT
                system_key_type,
                system_key,
                process,
                logical_clock
            FROM
                deletions
            WHERE
                deletions.system_key_type = system_key_type
            AND
                deletions.system_key = system_key
            AND
                deletions.process = process
            AND
                deletions.logical_clock = logical_clock
        )
        ON CONFLICT DO NOTHING
        RETURNING
            id,
            system_key_type,
            system_key,
            process,
            logical_clock;
    ";

    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_process = vec![];
    let mut p_logical_clock = vec![];
    let mut p_content_type = vec![];
    let mut p_content = vec![];
    let mut p_vector_clock = vec![];
    let mut p_indices = vec![];
    let mut p_signature = vec![];
    let mut p_raw_event = vec![];
    let mut p_server_time = vec![];
    let mut p_unix_milliseconds = vec![];

    for layers in batch.values() {
        p_system_key_type.push(i64::try_from(
            crate::model::public_key::get_key_type(layers.event().system()),
        )?);

        p_system_key.push(crate::model::public_key::get_key_bytes(
            layers.event().system(),
        ));

        p_process.push(layers.event().process().bytes());

        p_logical_clock.push(i64::try_from(*layers.event().logical_clock())?);

        p_content_type.push(i64::try_from(*layers.event().content_type())?);

        p_content.push(layers.event().content());

        p_vector_clock.push(layers.event().vector_clock().write_to_bytes()?);

        p_indices.push(layers.event().indices().write_to_bytes()?);

        p_signature.push(layers.signed_event().signature());

        p_raw_event.push(layers.raw_event());

        p_server_time.push(server_time);

        p_unix_milliseconds.push(
            layers
                .event()
                .unix_milliseconds()
                .map(i64::try_from)
                .transpose()?,
        );
    }

    Ok(())
}
