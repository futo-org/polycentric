pub(crate) struct Match {
    claim_event: crate::model::signed_event::SignedEvent,
    vouch_event: crate::model::signed_event::SignedEvent,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
pub(crate) struct Row {
    claim_event: ::std::vec::Vec<u8>,
    vouch_event: ::std::vec::Vec<u8>,
}

pub(crate) async fn query_find_claim_and_vouch(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    vouching_system: &crate::model::public_key::PublicKey,
    claiming_system: &crate::model::public_key::PublicKey,
    claim_type: u64,
    fields: &::std::vec::Vec<crate::protocol::ClaimFieldEntry>,
) -> ::anyhow::Result<::std::option::Option<Match>> {
    let query = "
        SELECT
            claim_events.raw_event as claim_event,
            vouch_events.raw_event as vouch_event
        FROM
            events as claim_events
        JOIN
            claims
        ON
            claim_events.id = claims.event_id
        JOIN
            event_links
        ON
            (
                event_links.subject_system_key_type,
                event_links.subject_system_key,
                event_links.subject_process,
                event_links.subject_logical_clock
            )
            =
            (
                claim_events.system_key_type,
                claim_events.system_key,
                claim_events.process,
                claim_events.logical_clock
            )
        JOIN
            events vouch_events
        ON
            vouch_events.id = event_links.event_id
        WHERE
            claim_events.content_type = $1
        AND
            claim_events.system_key_type = $2
        AND
            claim_events.system_key = $3
        AND
            claims.claim_type = $4
        AND
            claims.fields @> $5
        AND
            vouch_events.content_type = $6
        AND
            vouch_events.system_key_type = $7
        AND
            vouch_events.system_key = $8
        LIMIT 1;
    ";

    let potential_row = ::sqlx::query_as::<_, Row>(query)
        .bind(i64::try_from(crate::model::known_message_types::CLAIM)?)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            claiming_system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(claiming_system))
        .bind(i64::try_from(claim_type)?)
        .bind(crate::postgres::claim_fields_to_json_object(
            fields,
        ))
        .bind(i64::try_from(crate::model::known_message_types::VOUCH)?)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            vouching_system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(vouching_system))
        .fetch_optional(&mut *transaction)
        .await?;

    Ok(None)
}
