use crate::moderation::ModerationFilters;
use ::protobuf::{Message, MessageField};
use polycentric_protocol::protocol::Events;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    cursor: ::std::option::Option<String>,
    limit: ::std::option::Option<u64>,
    #[serde(
        deserialize_with = "crate::handlers::util::deserialize_json_string"
    )]
    moderation_filters: ::std::option::Option<ModerationFilters>,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let start_id = if let Some(cursor) = query.cursor {
        u64::from_le_bytes(crate::warp_try_err_500!(crate::warp_try_err_500!(
            ::base64::decode_config(cursor, ::base64::URL_SAFE)
        )
        .as_slice()
        .try_into()))
    } else {
        crate::warp_try_err_500!(u64::try_from(i64::MAX))
    };

    let limit = query.limit.unwrap_or(10);

    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let db_result = crate::warp_try_err_500!(
        crate::postgres::load_posts_before_id(
            &mut transaction,
            start_id,
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

    result.cursor = db_result
        .cursor
        .map(|cursor| u64::to_le_bytes(cursor).to_vec());
    crate::warp_try_err_500!(transaction.commit().await);

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
