use ::opensearch::SearchParts;
use ::protobuf::Message;
use ::protobuf::MessageField;
use ::serde_json::json;

use crate::moderation::{ModerationFilters, ModerationOptions};

#[derive(::serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(PartialEq, Debug, Clone)]
pub(crate) enum SearchType {
    Messages,
    Profiles,
}

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    search: String,
    cursor: ::std::option::Option<String>,
    limit: ::std::option::Option<u64>,
    search_type: ::std::option::Option<SearchType>,
    #[serde(
        default,
        deserialize_with = "crate::handlers::util::deserialize_json_string"
    )]
    moderation_filters: ::std::option::Option<ModerationFilters>,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let start_count = if let Some(cursor) = &query.cursor {
        u64::from_le_bytes(crate::warp_try_err_400!(crate::warp_try_err_400!(
            base64::decode(cursor)
        )
        .as_slice()
        .try_into()))
    } else {
        0
    };

    Ok(crate::warp_try_err_500!(
        handler_inner(
            state,
            query.search,
            query.limit.unwrap_or(10),
            start_count,
            query.search_type.unwrap_or(SearchType::Messages),
            &query.moderation_filters,
        )
        .await
    ))
}

pub(crate) async fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
    search: String,
    limit: u64,
    start_count: u64,
    search_type: SearchType,
    moderation_filters: &Option<ModerationFilters>,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    let response = state
        .search
        .search(match search_type {
            SearchType::Messages => SearchParts::Index(&["messages"]),
            SearchType::Profiles => {
                SearchParts::Index(&["profile_names", "profile_descriptions"])
            }
        })
        .from(i64::try_from(start_count)?)
        .size(i64::try_from(limit)?)
        .body(json!({
            "query": {
                "match": {
                    "message_content": {
                        "query": search,
                        "fuzziness": 2
                    }
                }
            }
        }))
        .send()
        .await?;

    let response_body = response
        .json::<crate::opensearch::OpenSearchSearchL0>()
        .await?;

    let mut transaction = state.pool_read_only.begin().await?;

    let mut result_events = polycentric_protocol::protocol::Events::new();

    if let Some(hits) = response_body.hits {
        for hit in hits.hits {
            let id = hit._id;
            if hit._index == "messages" {
                let pointer =
                    match polycentric_protocol::model::pointer::from_base64(&id)
                    {
                        Ok(ptr) => ptr,
                        Err(_) => {
                            continue;
                        }
                    };

                let event_result = crate::postgres::load_event(
                    &mut transaction,
                    pointer.system(),
                    pointer.process(),
                    *pointer.logical_clock(),
                    &ModerationOptions {
                        filters: moderation_filters.clone(),
                        mode: state.moderation_mode,
                    },
                )
                .await?;

                if let Some(event_result) = event_result {
                    result_events.events.push(
                        polycentric_protocol::model::signed_event::to_proto(
                            &event_result,
                        ),
                    );
                };
            } else {
                let system =
                    polycentric_protocol::model::public_key::from_base64(&id)?;

                let content_type = if hit._index == "profile_names" {
                    polycentric_protocol::model::known_message_types::USERNAME
                } else {
                    polycentric_protocol::model::known_message_types::DESCRIPTION
                };

                let potential_event =
                    crate::postgres::load_latest_system_wide_lww_event_by_type(
                        &mut transaction,
                        &system,
                        content_type,
                    )
                    .await?;

                if let Some(event) = potential_event {
                    result_events.events.push(
                        polycentric_protocol::model::signed_event::to_proto(
                            &event,
                        ),
                    );
                }
            }
        }
    }

    let mut result =
        polycentric_protocol::protocol::ResultEventsAndRelatedEventsAndCursor::new();

    let returned_event_count = u64::try_from(result_events.events.len())?;

    result.result_events = MessageField::some(result_events);

    result.cursor =
        Some(u64::to_le_bytes(start_count + returned_event_count).to_vec());

    transaction.commit().await?;

    Ok(Box::new(::warp::reply::with_status(
        result.write_to_bytes()?,
        ::warp::http::StatusCode::OK,
    )))
}
