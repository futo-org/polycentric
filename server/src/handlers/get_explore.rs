use crate::moderation::ModerationFilters;
use ::protobuf::{Message, MessageField};
use polycentric_protocol::protocol::Events;
use anyhow::{anyhow, bail, Context};

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    cursor: ::std::option::Option<String>,
    limit: ::std::option::Option<u64>,
    #[serde(
        default,
        deserialize_with = "crate::handlers::util::deserialize_json_string"
    )]
    moderation_filters: ::std::option::Option<ModerationFilters>,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let start_cursor: Option<(Option<i64>, i64)> = if let Some(cursor_str) = query.cursor {
        let parse_logic = || -> anyhow::Result<(Option<i64>, i64)> {
            let bytes = ::base64::decode_config(&cursor_str, ::base64::URL_SAFE)
                .map_err(|e| anyhow!("Cursor base64 decoding failed: {}", e))?;

            if bytes.len() == 16 { // Two i64 values (timestamp + id)
                let ts_bytes_slice = bytes.get(0..8).context("Invalid cursor: missing timestamp bytes")?;
                let id_bytes_slice = bytes.get(8..16).context("Invalid cursor: missing id bytes")?;
                
                let ts_array: [u8; 8] = ts_bytes_slice.try_into().map_err(|_| anyhow!("Invalid cursor: timestamp part not 8 bytes"))?;
                let id_array: [u8; 8] = id_bytes_slice.try_into().map_err(|_| anyhow!("Invalid cursor: id part not 8 bytes"))?;

                let timestamp = i64::from_le_bytes(ts_array);
                let id = i64::from_le_bytes(id_array);
                Ok((Some(timestamp), id))
            } else if bytes.len() == 8 { // Only id, timestamp is None
                 let id_array: [u8; 8] = bytes.as_slice().try_into().map_err(|_| anyhow!("Invalid cursor: single component not 8 bytes"))?;
                 let id = i64::from_le_bytes(id_array);
                 // load_posts_before_id handles None outer Option as first page (None, i64::MAX).
                 // If client sends a specific ID for a NULL timestamp event, it will be (None, id).
                 Ok((None, id))
            } else {
                bail!("Invalid cursor length: expected 8 or 16 bytes, got {}", bytes.len());
            }
        };
        Some(crate::warp_try_err_400!(parse_logic()))
    } else {
        None // No cursor provided, means first page
    };

    let limit = query.limit.unwrap_or(10);

    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let db_result = crate::warp_try_err_500!(
        crate::postgres::load_posts_before_id(
            &mut transaction,
            start_cursor, // Pass the parsed composite cursor
            limit,
            &crate::moderation::ModerationOptions {
                filters: query.moderation_filters.clone(),
                mode: state.moderation_mode,
            }
        )
        .await
    );

    let mut events = Events::new();

    for event in db_result.events.iter() {
        events
            .events
            .push(polycentric_protocol::model::signed_event::to_proto(event));
    }

    let mut result =
        polycentric_protocol::protocol::ResultEventsAndRelatedEventsAndCursor::new();
    result.result_events = MessageField::some(events);

    result.cursor = db_result.cursor.map(|(timestamp_opt, id)| {
        let mut bytes = Vec::new();
        if let Some(timestamp) = timestamp_opt {
            bytes.extend_from_slice(&timestamp.to_le_bytes());
            bytes.extend_from_slice(&id.to_le_bytes());
        } else {
            // If timestamp is None, only encode the id.
            bytes.extend_from_slice(&id.to_le_bytes());
        }
        bytes
    });

    crate::warp_try_err_500!(transaction.commit().await);

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, s-maxage=5, max-age=5",
    )))
}
