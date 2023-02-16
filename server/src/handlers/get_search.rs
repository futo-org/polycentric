use ::log::*;
use ::protobuf::Message;
use ::serde_json::json;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    search: String,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    /*
    let request = crate::protocol::Search::parse_from_tokio_bytes(&bytes)
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    info!("searching for {}", request.search);

    let response = state
        .search
        .search(::opensearch::SearchParts::Index(&["posts", "profiles"]))
        .body(json!({
            "query": {
                "multi_match": {
                    "query": request.search,
                    "fuzziness": 2,
                    "fields": [
                        "message",
                        "profile_description",
                        "profile_name"
                    ]
                }
            }
        }))
        .send()
        .await
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

    let response_body = response
        .json::<crate::OpenSearchSearchL0>()
        .await
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;
    */

    let mut transaction = match state.pool.begin().await {
        Ok(x) => x,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    /*
    let mut history: ::std::vec::Vec<crate::postgres::store_item::StoreItem> =
        vec![];

    for hit in response_body.hits.hits {
        let identity = ::ed25519_dalek::PublicKey::from_bytes(
            &::base64::decode(hit._source.author_public_key).unwrap(),
        )
        .map_err(|e| crate::RequestError::Anyhow(::anyhow::Error::new(e)))?;

        let writer = crate::model::vec_to_writer_id(
            &::base64::decode(hit._source.writer_id).unwrap(),
        )
        .map_err(|e| crate::RequestError::Anyhow(e))?;

        let sequence_number = hit._source.sequence_number;

        let store_item = crate::postgres::get_specific_event(
            &mut transaction,
            &crate::model::pointer::Pointer::new(
                identity,
                writer,
                sequence_number.try_into().unwrap(),
            ),
        )
        .await
        .map_err(|e| crate::RequestError::Anyhow(e))?;

        if let Some(event) = store_item {
            history.push(event);
        }
    }
    */

    let mut result =
        crate::protocol::ResultEventsAndRelatedEventsAndCursor::new();

    /*
    let mut processed_events =
        crate::process_mutations2(&mut transaction, history)
            .await
            .map_err(|e| crate::RequestError::Anyhow(e))?;

    result
        .related_events
        .append(&mut processed_events.related_events);

    result
        .result_events
        .append(&mut processed_events.result_events);
    */

    match transaction.commit().await {
        Ok(()) => (),
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    let result_serialized = match result.write_to_bytes() {
        Ok(x) => x,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    Ok(Box::new(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    )))
}
