use crate::cursor::ExploreCursor;
use crate::moderation::ModerationFilters;
use ::protobuf::{Message, MessageField};
use polycentric_protocol::protocol::Events;

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
    let start_cursor: Option<ExploreCursor> =
        if let Some(cursor_str) = query.cursor {
            let parse_logic = || -> anyhow::Result<ExploreCursor> {
                ExploreCursor::from_base64_str(&cursor_str)
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

    result.cursor = db_result.cursor.map(|cursor| cursor.to_bytes());

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
