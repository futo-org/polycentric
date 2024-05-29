#[derive(PartialEq, Debug)]
pub(crate) struct Match {
    pub(crate) claim: crate::model::signed_event::SignedEvent,
    pub(crate) path: ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
}

pub(crate) async fn select_match_any_field(
    transaction: &::deadpool_postgres::Transaction<'_>,
    claim_type: u64,
    trust_root: &crate::model::public_key::PublicKey,
    match_any_field: &String,
) -> ::anyhow::Result<::std::vec::Vec<Match>> {
    let query = "
        SELECT
            events.raw_event as claim_event,
            vouch_events.raw_event as vouch_event
        FROM
            events
        JOIN
            claims
        ON
            events.id = claims.event_id
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
                events.system_key_type,
                events.system_key,
                events.process,
                events.logical_clock
            )
        JOIN
            events vouch_events
        ON
            vouch_events.id = event_links.event_id
        WHERE
            events.content_type = $1
        AND
            claims.claim_type = $2
        AND
            jsonb_path_query_array(claims.fields, '$.*') ? $3
        AND
            vouch_events.content_type = $4
        AND
            vouch_events.system_key_type = $5
        AND
            vouch_events.system_key = $6
    ";

    let statement = transaction.prepare_cached(query).await?;

    let rows = transaction
        .query(
            &statement,
            &[
                &i64::try_from(crate::model::known_message_types::CLAIM)?,
                &i64::try_from(claim_type)?,
                match_any_field,
                &i64::try_from(crate::model::known_message_types::VOUCH)?,
                &i64::try_from(crate::model::public_key::get_key_type(
                    trust_root,
                ))?,
                &crate::model::public_key::get_key_bytes(trust_root),
            ],
        )
        .await?;

    let mut result = vec![];

    for row in rows {
        result.push(Match {
            claim: crate::model::signed_event::from_vec(row.try_get(0)?)?,
            path: vec![crate::model::signed_event::from_vec(row.try_get(1)?)?],
        });
    }

    Ok(result)
}

pub(crate) async fn select_match_all_fields(
    transaction: &::deadpool_postgres::Transaction<'_>,
    claim_type: u64,
    trust_root: &crate::model::public_key::PublicKey,
    match_all_fields: &[crate::protocol::ClaimFieldEntry],
) -> ::anyhow::Result<::std::vec::Vec<Match>> {
    let query = "
        SELECT
            events.raw_event as claim_event,
            vouch_events.raw_event as vouch_event
        FROM
            events
        JOIN
            claims
        ON
            events.id = claims.event_id
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
                events.system_key_type,
                events.system_key,
                events.process,
                events.logical_clock
            )
        JOIN
            events vouch_events
        ON
            vouch_events.id = event_links.event_id
        WHERE
            events.content_type = $1
        AND
            claims.claim_type = $2
        AND
            jsonb_path_query_array(claims.fields, '$.*') ? $3
        AND
            vouch_events.content_type = $4
        AND
            vouch_events.system_key_type = $5
        AND
            vouch_events.system_key = $6
    ";

    let statement = transaction.prepare_cached(query).await?;

    let rows = transaction
        .query(
            &statement,
            &[
                &i64::try_from(crate::model::known_message_types::CLAIM)?,
                &i64::try_from(claim_type)?,
                &crate::postgres::claim_fields_to_json_object(match_all_fields),
                &i64::try_from(crate::model::known_message_types::VOUCH)?,
                &i64::try_from(crate::model::public_key::get_key_type(
                    trust_root,
                ))?,
                &crate::model::public_key::get_key_bytes(trust_root),
            ],
        )
        .await?;

    let mut result = vec![];

    for row in rows {
        result.push(Match {
            claim: crate::model::signed_event::from_vec(row.try_get(0)?)?,
            path: vec![crate::model::signed_event::from_vec(row.try_get(1)?)?],
        });
    }

    Ok(result)
}
