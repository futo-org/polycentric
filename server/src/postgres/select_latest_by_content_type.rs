use ::protobuf::Message;

use super::ModerationFilters;

pub(crate) async fn select(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    content_types: &[u64],
    moderation_options: &crate::moderation::ModerationOptions,
) -> ::anyhow::Result<
    ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
> {
    let query = "
        WITH input_rows (
            system_key_type,
            system_key,
            content_type
        ) AS (
            SELECT
                *
            FROM
                UNNEST(
                    $1::bigint [],
                    $2::bytea [],
                    $3::bigint []
                ) AS p (
                    system_key_type,
                    system_key,
                    content_type
                )
        )

        SELECT DISTINCT ON (
            events.system_key_type,
            events.process,
            events.content_type
        ) raw_event FROM
            events
        INNER JOIN
            input_rows
        ON
            events.system_key_type = input_rows.system_key_type
        AND
            events.system_key = input_rows.system_key
        AND
            events.content_type = input_rows.content_type
        AND
            filter_events_by_moderation(events, $4::moderation_filter_type[], $5::moderation_mode)
        ORDER BY
            events.system_key_type,
            events.system_key,
            events.process,
            events.content_type,
            events.logical_clock DESC
    ";

    let mut p_system_key_type = vec![];
    let mut p_system_key = vec![];
    let mut p_content_type = vec![];

    for content_type in content_types.iter() {
        p_system_key_type.push(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?);
        p_system_key.push(
            polycentric_protocol::model::public_key::get_key_bytes(system),
        );
        p_content_type.push(i64::try_from(*content_type)?);
    }

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(p_system_key_type)
        .bind(p_system_key)
        .bind(p_content_type)
        .bind(
            moderation_options
                .filters
                .as_ref()
                .unwrap_or(&ModerationFilters::empty()),
        )
        .bind(moderation_options.mode)
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
