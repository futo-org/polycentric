use ::protobuf::Message;

pub(crate) async fn select(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    content_types: &Vec<u64>,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
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
            events.system_key,
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
        ORDER BY
            events.system_key_type DESC,
            events.system_key DESC,
            events.process DESC,
            events.content_type DESC,
            events.logical_clock DESC
    ";

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

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(p_system_key_type)
        .bind(p_system_key)
        .bind(p_content_type)
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::signed_event::from_proto(
                &crate::protocol::SignedEvent::parse_from_bytes(raw)?,
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()
}
