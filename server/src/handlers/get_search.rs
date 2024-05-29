use ::opensearch::SearchParts;
use ::protobuf::Message;
use ::protobuf::MessageField;
use ::serde_json::json;

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

    let response_body = response.json::<crate::OpenSearchSearchL0>().await?;

    let mut pointers_to_load = vec![];
    let mut lww_to_load = vec![];

    if let Some(hits) = response_body.hits {
        for hit in hits.hits {
            let id = hit._id;
            if hit._index == "messages" {
                pointers_to_load.push(crate::model::pointer::from_base64(&id)?);
            } else {
                let system = crate::model::public_key::from_base64(&id)?;

                let content_type = if hit._index == "profile_names" {
                    crate::model::known_message_types::USERNAME
                } else {
                    crate::model::known_message_types::DESCRIPTION
                };

                lww_to_load.push(crate::queries::select_latest_lww::InputRow {
                    system: system,
                    content_type: content_type,
                });
            }
        }
    }

    let mut result_events = crate::protocol::Events::new();

    let mut client = state.deadpool_write.get().await?;

    let transaction = client.transaction().await?;

    let (batch1, batch2) = ::tokio::try_join!(
        crate::queries::select_events_by_pointer::select(
            &transaction,
            pointers_to_load
        ),
        crate::queries::select_latest_lww::select(&transaction, lww_to_load),
    )?;

    transaction.commit().await?;

    for signed_event in batch1 {
        result_events
            .events
            .push(crate::model::signed_event::to_proto(&signed_event));
    }

    for signed_event in batch2 {
        result_events
            .events
            .push(crate::model::signed_event::to_proto(&signed_event));
    }

    let mut result =
        crate::protocol::ResultEventsAndRelatedEventsAndCursor::new();

    let returned_event_count = u64::try_from(result_events.events.len())?;

    result.result_events = MessageField::some(result_events);

    result.cursor =
        Some(u64::to_le_bytes(start_count + returned_event_count).to_vec());

    Ok(Box::new(::warp::reply::with_status(
        result.write_to_bytes()?,
        ::warp::http::StatusCode::OK,
    )))
}
