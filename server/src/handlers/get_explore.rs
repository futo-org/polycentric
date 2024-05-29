use crate::protocol::Events;
use ::protobuf::{Message, MessageField};

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    cursor: ::std::option::Option<String>,
    limit: ::std::option::Option<u64>,
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
        crate::warp_try_err_500!(u64::try_from(i64::max_value()))
    };

    let limit = query.limit.unwrap_or(10);

    let mut client = crate::warp_try_err_500!(state.deadpool_write.get().await);

    let transaction = crate::warp_try_err_500!(client.transaction().await);

    let db_result = crate::warp_try_err_500!(
        crate::queries::select_events_before_id::select(
            &transaction,
            start_id,
            limit
        )
        .await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    let mut events = Events::new();

    for event in db_result.events.iter() {
        events
            .events
            .push(crate::model::signed_event::to_proto(event));
    }

    let mut result =
        crate::protocol::ResultEventsAndRelatedEventsAndCursor::new();
    result.result_events = MessageField::some(events);

    result.cursor = db_result
        .cursor
        .map(|cursor| u64::to_le_bytes(cursor).to_vec());

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
