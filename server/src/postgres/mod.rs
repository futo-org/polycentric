use ::protobuf::Message;
use ::sqlx::Executor;
use ::std::convert::TryFrom;

use crate::moderation::{ModerationFilters, ModerationOptions};

pub(crate) mod count_lww_element_references;
pub(crate) mod count_references;
pub(crate) mod purge;
pub(crate) mod query_claims;
pub(crate) mod query_find_claim_and_vouch;
pub(crate) mod query_index;
pub(crate) mod query_references;
pub(crate) mod select_events_by_ranges;
pub(crate) mod select_latest_by_content_type;
pub(crate) mod select_system_locks;
pub(crate) mod update_counts;

#[derive(::sqlx::Type)]
#[sqlx(type_name = "censorship_type")]
#[sqlx(rename_all = "snake_case")]
#[derive(::serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CensorshipType {
    DoNotRecommend,
    RefuseStorage,
}

#[derive(::sqlx::Type)]
#[sqlx(type_name = "link_type")]
#[sqlx(rename_all = "snake_case")]
pub(crate) enum LinkType {
    React,
    Boost,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
struct EventRow {
    #[sqlx(try_from = "i64")]
    id: u64,
    #[sqlx(try_from = "i64")]
    system_key_type: u64,
    system_key: ::std::vec::Vec<u8>,
    process: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    logical_clock: u64,
    #[sqlx(try_from = "i64")]
    content_type: u64,
    content: ::std::vec::Vec<u8>,
    vector_clock: ::std::vec::Vec<u8>,
    indices: ::std::vec::Vec<u8>,
    signature: ::std::vec::Vec<u8>,
    raw_event: ::std::vec::Vec<u8>,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
struct ExploreRow {
    #[sqlx(try_from = "i64")]
    id: u64,
    #[sqlx(try_from = "i64")]
    server_time: u64,
    raw_event: ::std::vec::Vec<u8>,
    moderation_tags: Option<
        ::std::vec::Vec<
            polycentric_protocol::model::moderation_tag::ModerationTag,
        >,
    >,
}

#[allow(dead_code)]
#[derive(PartialEq, Debug, ::sqlx::FromRow)]
struct RangeRow {
    process: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    low: u64,
    #[sqlx(try_from = "i64")]
    high: u64,
}

#[allow(dead_code)]
#[derive(PartialEq, Debug, ::sqlx::FromRow)]
struct SystemRow {
    system_key: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    system_key_type: u64,
}

pub(crate) struct EventsAndCursor {
    pub events:
        ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
    pub cursor: Option<u64>,
}

pub(crate) async fn prepare_database(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::sqlx::Result<()> {
    transaction.execute(include_str!("schema.sql")).await?;
    Ok(())
}

#[allow(dead_code)]
#[derive(PartialEq, Debug, ::sqlx::FromRow)]
struct RawEventRow {
    raw_event: ::std::vec::Vec<u8>,
    moderation_tags:
        Option<::std::vec::Vec<crate::model::moderation_tag::ModerationTag>>,
}

pub(crate) async fn load_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    process: &polycentric_protocol::model::process::Process,
    logical_clock: u64,
    moderation_options: &ModerationOptions,
) -> ::anyhow::Result<
    Option<polycentric_protocol::model::signed_event::SignedEvent>,
> {
    let query = "
        SELECT raw_event, moderation_tags FROM events
        WHERE system_key_type = $1
        AND   system_key      = $2
        AND   process         = $3
        AND   logical_clock   = $4
        AND   filter_events_by_moderation(events, $5::moderation_filter_type[], $6::moderation_mode)
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_as::<_, RawEventRow>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .bind(
            moderation_options
                .filters
                .as_ref()
                .unwrap_or(&ModerationFilters::default()),
        )
        .bind(moderation_options.mode)
        .fetch_optional(&mut **transaction)
        .await?;

    match potential_raw {
        Some(raw) => Ok(Some({
            let mut event =
                polycentric_protocol::model::signed_event::from_proto(
                    &polycentric_protocol::protocol::SignedEvent::parse_from_bytes(
                        &raw.raw_event,
                    )?,
                )?;
            event.set_moderation_tags(raw.moderation_tags.unwrap_or_default());
            event
        })),
        None => Ok(None),
    }
}

pub(crate) async fn load_events_after_id(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    start_id: &::std::option::Option<u64>,
    limit: u64,
    moderation_options: &ModerationOptions,
) -> ::anyhow::Result<EventsAndCursor> {
    let query = "
        SELECT
            id, raw_event, server_time, moderation_tags
        FROM
            events
        WHERE
            ($1 IS NULL OR id > $1)
        AND filter_events_by_moderation(events, $3::moderation_filter_type[], $4::moderation_mode)
        ORDER BY
            id ASC
        LIMIT $2;
    ";

    let start_id_query = if let Some(x) = start_id {
        Some(i64::try_from(*x)?)
    } else {
        None
    };

    let rows = ::sqlx::query_as::<_, ExploreRow>(query)
        .bind(start_id_query)
        .bind(i64::try_from(limit)?)
        .bind(
            moderation_options
                .filters
                .as_ref()
                .unwrap_or(&ModerationFilters::default()),
        )
        .bind(moderation_options.mode)
        .fetch_all(&mut **transaction)
        .await?;

    let mut result_set = vec![];

    for row in rows.iter() {
        let event =
            polycentric_protocol::model::signed_event::from_raw_event_with_moderation_tags(
                &row.raw_event,
                row.moderation_tags.clone()
            )?;
        result_set.push(event);
    }

    let result = EventsAndCursor {
        events: result_set,
        cursor: rows.last().map(|last_elem| last_elem.id),
    };

    Ok(result)
}

pub(crate) async fn load_posts_before_id(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    start_id: u64,
    limit: u64,
    moderation_options: &ModerationOptions,
) -> ::anyhow::Result<EventsAndCursor> {
    let query = "
        SELECT id, raw_event, server_time, moderation_tags FROM events
        WHERE id < $1
        AND content_type = $2
        AND filter_events_by_moderation(events, $4::moderation_filter_type[], $5::moderation_mode)
        ORDER BY id DESC
        LIMIT $3;
    ";

    let rows = ::sqlx::query_as::<_, ExploreRow>(query)
        .bind(i64::try_from(start_id)?)
        .bind(i64::try_from(
            polycentric_protocol::model::known_message_types::POST,
        )?)
        .bind(i64::try_from(limit)?)
        .bind(
            moderation_options
                .filters
                .as_ref()
                .unwrap_or(&ModerationFilters::default()),
        )
        .bind(moderation_options.mode)
        .fetch_all(&mut **transaction)
        .await?;

    let mut result_set = vec![];

    for row in rows.iter() {
        let event =
            polycentric_protocol::model::signed_event::from_raw_event_with_moderation_tags(
                &row.raw_event,
                row.moderation_tags.clone()
            )?;
        result_set.push(event);
    }

    let result = EventsAndCursor {
        events: result_set,
        cursor: rows.last().map(|last_elem| last_elem.id),
    };

    Ok(result)
}

pub(crate) async fn load_processes_for_system(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
) -> ::anyhow::Result<
    ::std::vec::Vec<polycentric_protocol::model::process::Process>,
> {
    let query = "
        SELECT DISTINCT process
        FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(polycentric_protocol::model::process::from_vec)
        .collect::<::anyhow::Result<
            ::std::vec::Vec<polycentric_protocol::model::process::Process>,
        >>()
}

pub(crate) async fn load_latest_system_wide_lww_event_by_type(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
    content_type: u64,
) -> ::anyhow::Result<
    Option<polycentric_protocol::model::signed_event::SignedEvent>,
> {
    let query = "
        SELECT
            events.raw_event
        FROM
            events 
        INNER JOIN
            lww_elements 
        ON
            events.id = lww_elements.event_id 
        WHERE
            events.system_key_type = $1
        AND
            events.system_key = $2
        AND
            events.content_type = $3
        ORDER BY
            lww_elements.unix_milliseconds DESC,
            events.process DESC
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .bind(i64::try_from(content_type)?)
        .fetch_optional(&mut **transaction)
        .await?;

    match potential_raw {
        Some(raw) => {
            Ok(Some(polycentric_protocol::model::signed_event::from_proto(
                &polycentric_protocol::protocol::SignedEvent::parse_from_bytes(
                    &raw,
                )?,
            )?))
        }
        None => Ok(None),
    }
}

pub(crate) async fn does_event_exist(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &polycentric_protocol::model::event::Event,
) -> ::anyhow::Result<bool> {
    let query_select_deleted = "
        SELECT 1 FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        AND process = $3
        AND logical_clock = $4
        LIMIT 1;
    ";

    let does_exist = ::sqlx::query_scalar::<_, i32>(query_select_deleted)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(
                event.system(),
            ),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            event.system(),
        ))
        .bind(event.process().bytes())
        .bind(i64::try_from(*event.logical_clock())?)
        .fetch_optional(&mut **transaction)
        .await?;

    Ok(does_exist.is_some())
}

pub(crate) async fn is_event_deleted(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &polycentric_protocol::model::event::Event,
) -> ::anyhow::Result<bool> {
    let query_select_deleted = "
        SELECT 1 FROM deletions
        WHERE system_key_type = $1
        AND system_key = $2
        AND process = $3
        AND logical_clock = $4
        LIMIT 1;
    ";

    let is_deleted = ::sqlx::query_scalar::<_, i32>(query_select_deleted)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(
                event.system(),
            ),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            event.system(),
        ))
        .bind(event.process().bytes())
        .bind(i64::try_from(*event.logical_clock())?)
        .fetch_optional(&mut **transaction)
        .await?;

    Ok(is_deleted.is_some())
}

pub(crate) async fn delete_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    system: &polycentric_protocol::model::public_key::PublicKey,
    delete: &polycentric_protocol::model::delete::Delete,
) -> ::anyhow::Result<()> {
    let query_insert_delete = "
        INSERT INTO deletions
        (
            system_key_type,
            system_key,
            process,
            logical_clock,
            event_id,
            unix_milliseconds,
            content_type
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7
        );
    ";

    let query_delete_event = "
        DELETE FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        AND process = $3
        AND logical_clock = $4;
    ";

    ::sqlx::query(query_insert_delete)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .bind(delete.process().bytes())
        .bind(i64::try_from(*delete.logical_clock())?)
        .bind(i64::try_from(event_id)?)
        .bind(delete.unix_milliseconds().map(i64::try_from).transpose()?)
        .bind(i64::try_from(*delete.content_type())?)
        .execute(&mut **transaction)
        .await?;

    ::sqlx::query(query_delete_event)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .bind(delete.process().bytes())
        .bind(i64::try_from(*delete.logical_clock())?)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &polycentric_protocol::model::signed_event::SignedEvent,
    server_time: u64,
) -> ::anyhow::Result<u64> {
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id;
    ";

    let event = polycentric_protocol::model::event::from_proto(
        &polycentric_protocol::protocol::Event::parse_from_bytes(
            signed_event.event(),
        )?,
    )?;

    let serialized =
        polycentric_protocol::model::signed_event::to_proto(signed_event)
            .write_to_bytes()?;

    let id = ::sqlx::query_scalar::<_, i64>(query_insert_event)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(
                event.system(),
            ),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            event.system(),
        ))
        .bind(event.process().bytes())
        .bind(i64::try_from(*event.logical_clock())?)
        .bind(i64::try_from(*event.content_type())?)
        .bind(event.content())
        .bind(event.vector_clock().write_to_bytes()?)
        .bind(event.indices().write_to_bytes()?)
        .bind(signed_event.signature())
        .bind(&serialized)
        .bind(i64::try_from(server_time)?)
        .bind(event.unix_milliseconds().map(i64::try_from).transpose()?)
        .fetch_one(&mut **transaction)
        .await?;

    Ok(u64::try_from(id)?)
}

pub(crate) async fn insert_event_link(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    link_content_type: u64,
    pointer: &polycentric_protocol::model::pointer::Pointer,
) -> ::anyhow::Result<()> {
    let query_insert_event_link = "
        INSERT INTO event_links
        (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            link_content_type,
            event_id
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
        )
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query_insert_event_link)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(
                pointer.system(),
            ),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            pointer.system(),
        ))
        .bind(pointer.process().bytes())
        .bind(i64::try_from(*pointer.logical_clock())?)
        .bind(i64::try_from(link_content_type)?)
        .bind(i64::try_from(event_id)?)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_event_reference_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    bytes: &::std::vec::Vec<u8>,
    event_id: u64,
) -> ::anyhow::Result<()> {
    let query_insert_event_link = "
        INSERT INTO event_references_bytes
        (
            subject_bytes,
            event_id
        )
        VALUES (
            $1,
            $2
        )
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query_insert_event_link)
        .bind(bytes)
        .bind(i64::try_from(event_id)?)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_event_index(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    index_type: u64,
    logical_clock: u64,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO event_indices
        (
            index_type,
            logical_clock,
            event_id
        )
        VALUES (
            $1,
            $2,
            $3
        )
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query)
        .bind(i64::try_from(index_type)?)
        .bind(i64::try_from(logical_clock)?)
        .bind(i64::try_from(event_id)?)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) fn claim_fields_to_json_object(
    fields: &[polycentric_protocol::protocol::ClaimFieldEntry],
) -> ::serde_json::Value {
    ::serde_json::Value::Object(
        fields
            .iter()
            .map(|field| {
                (
                    field.key.to_string(),
                    ::serde_json::Value::String(field.value.clone()),
                )
            })
            .collect::<::serde_json::Map<String, ::serde_json::Value>>(),
    )
}

pub(crate) async fn insert_claim(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    claim: &polycentric_protocol::model::claim::Claim,
) -> ::anyhow::Result<()> {
    let query_insert_claim = "
        INSERT INTO claims
        (
            claim_type,
            event_id,
            fields
        )
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query_insert_claim)
        .bind(i64::try_from(*claim.claim_type())?)
        .bind(i64::try_from(event_id)?)
        .bind(claim_fields_to_json_object(claim.claim_fields()))
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_lww_element(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    lww_element: &polycentric_protocol::protocol::LWWElement,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO lww_elements 
        (
            value,
            unix_milliseconds,
            event_id
        )
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query)
        .bind(&lww_element.value)
        .bind(i64::try_from(lww_element.unix_milliseconds)?)
        .bind(i64::try_from(event_id)?)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) async fn load_system_head(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
) -> ::anyhow::Result<
    ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
> {
    let query = "
        SELECT DISTINCT ON (
            system_key_type,
            system_key,
            process
        )
        raw_event
        FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        ORDER BY system_key_type, system_key, process, logical_clock DESC;
    ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
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

pub(crate) async fn known_ranges_for_system(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &polycentric_protocol::model::public_key::PublicKey,
) -> ::anyhow::Result<polycentric_protocol::protocol::RangesForSystem> {
    let query = "
        SELECT
            process,
            MIN(logical_clock) as low,
            MAX(logical_clock) as high
        FROM (
            SELECT
                *, ROW_NUMBER() OVER(ORDER BY process, logical_clock) as rn
            FROM (
                SELECT
                    process, logical_clock
                FROM
                    events
                WHERE
                    system_key_type = $1
                AND
                    system_key = $2
                UNION ALL
                SELECT
                    process, logical_clock
                FROM
                    deletions
                WHERE
                    system_key_type = $1
                AND
                    system_key = $2
            ) t2
        ) t1
        GROUP BY process, logical_clock - rn
        ORDER BY process, low;
    ";

    let ranges = ::sqlx::query_as::<_, RangeRow>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .fetch_all(&mut **transaction)
        .await
        .map_err(::anyhow::Error::new)?;

    let mut result = polycentric_protocol::protocol::RangesForSystem::new();

    for range in ranges.iter() {
        let process = ::protobuf::MessageField::some(
            polycentric_protocol::model::process::to_proto(
                &polycentric_protocol::model::process::from_vec(
                    &range.process,
                )?,
            ),
        );

        let mut found: Option<
            &mut polycentric_protocol::protocol::RangesForProcess,
        > = None;

        for ranges_for_process in result.ranges_for_processes.iter_mut() {
            if ranges_for_process.process == process {
                found = Some(ranges_for_process);

                break;
            }
        }

        let ranges_for_process = match found {
            Some(x) => x,
            None => {
                let mut next =
                    polycentric_protocol::protocol::RangesForProcess::new();
                next.process = process;
                result.ranges_for_processes.push(next);
                result.ranges_for_processes.last_mut().unwrap()
            }
        };

        let mut range_proto = polycentric_protocol::protocol::Range::new();
        range_proto.low = range.low;
        range_proto.high = range.high;
        ranges_for_process.ranges.push(range_proto);
    }

    Ok(result)
}

pub(crate) async fn censor_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    censor_type: CensorshipType,
    system: &polycentric_protocol::model::public_key::PublicKey,
    process: &polycentric_protocol::model::process::Process,
    logical_clock: u64,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO censored_events (
            system_key_type,
            system_key,
            process,
            logical_clock,
            censorship_type
        )
        VALUES ($1, $2, $3, $4, $5);
        ";
    ::sqlx::query(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .bind(censor_type)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}
pub(crate) async fn censor_system(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    censor_type: CensorshipType,
    system: polycentric_protocol::model::public_key::PublicKey,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO censored_systems (
            system_key_type,
            system_key,
            censorship_type
        )
        VALUES ($1, $2, $3);
        ";
    ::sqlx::query(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(&system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            &system,
        ))
        .bind(censor_type)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) async fn claim_handle(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    handle: String,
    system: &polycentric_protocol::model::public_key::PublicKey,
) -> ::anyhow::Result<()> {
    let query_del = "
        DELETE FROM identity_handles 
        WHERE
            system_key_type = $1
            AND 
            system_key = $2
        ;
        ";

    ::sqlx::query(query_del)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .execute(&mut **transaction)
        .await?;

    let query = "
        INSERT INTO identity_handles (
            system_key_type,
            system_key,
            handle
        )
        VALUES ($1, $2, $3);
        ";
    ::sqlx::query(query)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(system),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            system,
        ))
        .bind(handle)
        .execute(&mut **transaction)
        .await?;

    Ok(())
}

pub(crate) async fn resolve_handle(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    handle: String,
) -> ::anyhow::Result<polycentric_protocol::model::public_key::PublicKey> {
    let query = "
        SELECT
            system_key,
            system_key_type
        FROM
            identity_handles
        WHERE
            handle = $1;
    ";

    let sys_row = ::sqlx::query_as::<_, SystemRow>(query)
        .bind(handle)
        .fetch_one(&mut **transaction)
        .await
        .map_err(::anyhow::Error::new)?;

    let sys = polycentric_protocol::model::public_key::from_type_and_bytes(
        sys_row.system_key_type,
        &sys_row.system_key,
    )?;

    Ok(sys)
}

pub(crate) async fn load_random_profiles(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    moderation_options: &ModerationOptions,
) -> ::anyhow::Result<Vec<polycentric_protocol::model::public_key::PublicKey>> {
    let query = "
    SELECT 
      system_key_type, 
      system_key 
    FROM 
      (
        SELECT 
          DISTINCT events.system_key_type, 
          events.system_key 
        FROM 
          events 
          LEFT JOIN censored_systems
          ON events.system_key_type = censored_systems.system_key_type 
          AND events.system_key = censored_systems.system_key 
        WHERE 
          censored_systems.system_key IS NULL
          AND filter_events_by_moderation(events, $1::moderation_filter_type[])
      ) AS systems 
    ORDER BY 
      RANDOM() 
    LIMIT 
      10;
    ";

    let sys_rows = ::sqlx::query_as::<_, SystemRow>(query)
        .bind(moderation_options.filters.as_ref().unwrap_or(&ModerationFilters::empty()))
        .bind(moderation_options.mode)
        .fetch_all(&mut **transaction)
        .await?;

    let mut result_set = vec![];
    for sys_row in sys_rows.iter() {
        let sys = polycentric_protocol::model::public_key::from_type_and_bytes(
            sys_row.system_key_type,
            &sys_row.system_key,
        )?;
        result_set.push(sys);
    }

    Ok(result_set)
}

#[cfg(test)]
pub mod tests {
    use ::protobuf::Message;

    use crate::config::ModerationMode;

    #[::sqlx::test]
    async fn test_prepare_database(pool: ::sqlx::PgPool) -> ::sqlx::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    #[::sqlx::test]
    async fn test_persist_event(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = polycentric_protocol::test_utils::make_test_keypair();
        let process = polycentric_protocol::test_utils::make_test_process();

        let signed_event = polycentric_protocol::test_utils::make_test_event(
            &keypair, &process, 52,
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &signed_event)
            .await?;

        let system =
            polycentric_protocol::model::public_key::PublicKey::Ed25519(
                keypair.verifying_key(),
            );

        let loaded_event = crate::postgres::load_event(
            &mut transaction,
            &system,
            &process,
            52,
            &crate::postgres::ModerationOptions {
                filters: None,
                mode: ModerationMode::Off,
            },
        )
        .await?;

        transaction.commit().await?;

        assert!(Some(signed_event) == loaded_event);

        Ok(())
    }

    #[::sqlx::test]
    async fn test_head(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = polycentric_protocol::test_utils::make_test_keypair();
        let s2 = polycentric_protocol::test_utils::make_test_keypair();

        let s1p1 = polycentric_protocol::test_utils::make_test_process();
        let s1p2 = polycentric_protocol::test_utils::make_test_process();
        let s2p1 = polycentric_protocol::test_utils::make_test_process();

        let s1p1e1 =
            polycentric_protocol::test_utils::make_test_event(&s1, &s1p1, 1);
        let s1p1e2 =
            polycentric_protocol::test_utils::make_test_event(&s1, &s1p1, 2);
        let s1p2e1 =
            polycentric_protocol::test_utils::make_test_event(&s1, &s1p2, 1);
        let s2p1e5 =
            polycentric_protocol::test_utils::make_test_event(&s2, &s2p1, 5);

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e5).await?;

        let system =
            polycentric_protocol::model::public_key::PublicKey::Ed25519(
                s1.verifying_key(),
            );

        let head = crate::postgres::load_system_head(&mut transaction, &system)
            .await?;

        transaction.commit().await?;

        let expected = [s1p1e2, s1p2e1];

        assert!(expected.len() == head.len());

        for expected_item in expected.iter() {
            let mut found = false;

            for got_item in head.iter() {
                if got_item == expected_item {
                    found = true;
                    break;
                }
            }

            assert!(found);
        }

        Ok(())
    }

    #[::sqlx::test]
    async fn test_known_ranges(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = polycentric_protocol::test_utils::make_test_keypair();
        let s2 = polycentric_protocol::test_utils::make_test_keypair();

        let s1p1 = polycentric_protocol::test_utils::make_test_process();
        let s1p2 = polycentric_protocol::test_utils::make_test_process();
        let s2p1 = polycentric_protocol::test_utils::make_test_process();

        let s1p1e1 =
            polycentric_protocol::test_utils::make_test_event(&s1, &s1p1, 1);
        let s1p1e2 =
            polycentric_protocol::test_utils::make_test_event(&s1, &s1p1, 2);
        let s1p1e6 =
            polycentric_protocol::test_utils::make_test_event(&s1, &s1p1, 6);
        let s1p2e1 =
            polycentric_protocol::test_utils::make_test_event(&s1, &s1p2, 1);
        let s2p1e5 =
            polycentric_protocol::test_utils::make_test_event(&s2, &s2p1, 5);

        let mut delete = polycentric_protocol::protocol::Delete::new();
        delete.process = ::protobuf::MessageField::some(
            polycentric_protocol::model::process::to_proto(&s1p1),
        );
        delete.logical_clock = 2;
        delete.indices = ::protobuf::MessageField::some(
            polycentric_protocol::protocol::Indices::new(),
        );

        let s1p1e3 =
            polycentric_protocol::test_utils::make_test_event_with_content(
                &s1,
                &s1p1,
                3,
                0,
                &delete.write_to_bytes()?,
                vec![],
            );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e3).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e6).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e5).await?;

        let system =
            polycentric_protocol::model::public_key::PublicKey::Ed25519(
                s1.verifying_key(),
            );

        let ranges =
            crate::postgres::known_ranges_for_system(&mut transaction, &system)
                .await?;

        transaction.commit().await?;

        let mut expected =
            polycentric_protocol::protocol::RangesForSystem::new();

        let mut expected_p1 =
            polycentric_protocol::protocol::RangesForProcess::new();
        expected_p1.process = ::protobuf::MessageField::some(
            polycentric_protocol::model::process::to_proto(&s1p1),
        );

        let mut expected_p1r1 = polycentric_protocol::protocol::Range::new();
        expected_p1r1.low = 1;
        expected_p1r1.high = 3;

        let mut expected_p1r2 = polycentric_protocol::protocol::Range::new();
        expected_p1r2.low = 6;
        expected_p1r2.high = 6;

        expected_p1.ranges.push(expected_p1r1);
        expected_p1.ranges.push(expected_p1r2);

        let mut expected_p2 =
            polycentric_protocol::protocol::RangesForProcess::new();
        expected_p2.process = ::protobuf::MessageField::some(
            polycentric_protocol::model::process::to_proto(&s1p2),
        );

        let mut expected_p2r1 = polycentric_protocol::protocol::Range::new();
        expected_p2r1.low = 1;
        expected_p2r1.high = 1;

        expected_p2.ranges.push(expected_p2r1);

        expected.ranges_for_processes.push(expected_p1);
        expected.ranges_for_processes.push(expected_p2);

        assert!(
            expected.ranges_for_processes.len()
                == ranges.ranges_for_processes.len()
        );

        for expected_item in expected.ranges_for_processes.iter() {
            let mut found = false;

            for got_item in ranges.ranges_for_processes.iter() {
                if got_item == expected_item {
                    found = true;
                    break;
                }
            }

            assert!(found);
        }

        Ok(())
    }

    #[::sqlx::test]
    async fn test_handles(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = polycentric_protocol::test_utils::make_test_keypair();
        let s2 = polycentric_protocol::test_utils::make_test_keypair();

        let system1 =
            polycentric_protocol::model::public_key::PublicKey::Ed25519(
                s1.verifying_key(),
            );

        let system2 =
            polycentric_protocol::model::public_key::PublicKey::Ed25519(
                s2.verifying_key(),
            );

        transaction.commit().await?;

        transaction = pool.begin().await?;
        crate::postgres::claim_handle(
            &mut transaction,
            String::from("osotnoc"),
            &system1,
        )
        .await?;

        transaction.commit().await?;

        transaction = pool.begin().await?;
        assert!(crate::postgres::claim_handle(
            &mut transaction,
            String::from("osotnoc_2"),
            &system1
        )
        .await
        .is_ok());

        transaction.commit().await?;

        transaction = pool.begin().await?;
        assert!(crate::postgres::claim_handle(
            &mut transaction,
            String::from("osotnoc"),
            &system1
        )
        .await
        .is_ok());

        transaction.commit().await?;

        transaction = pool.begin().await?;
        assert!(!crate::postgres::claim_handle(
            &mut transaction,
            String::from("osotnoc"),
            &system2
        )
        .await
        .is_ok());

        transaction = pool.begin().await?;
        crate::postgres::claim_handle(
            &mut transaction,
            String::from("futo_test"),
            &system2,
        )
        .await?;
        transaction.commit().await?;

        transaction = pool.begin().await?;
        assert!(
            crate::postgres::resolve_handle(
                &mut transaction,
                String::from("futo_test")
            )
            .await?
                == system2
        );
        assert!(
            crate::postgres::resolve_handle(
                &mut transaction,
                String::from("osotnoc")
            )
            .await?
                != system2
        );
        assert!(
            crate::postgres::resolve_handle(
                &mut transaction,
                String::from("osotnoc")
            )
            .await?
                == system1
        );

        Ok(())
    }
}
