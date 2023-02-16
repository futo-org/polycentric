use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    cursor: Option<u64>,
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
    #[serde(deserialize_with = "crate::model::process::serde_url_deserialize")]
    process: crate::model::process::Process,
    logical_clock: u64,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
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
    let history = match
        crate::postgres::get_events_linking_to(
            &mut transaction,
            &crate::postgres::LinkType::React,
            &crate::model::pointer::Pointer::new(
                query.identity,
                query.writer_id,
                query.sequence_number,
            ),
        ).await
    {
        Ok(a) => a,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    let mut processed_events =
        match crate::process_mutations2(&mut transaction, history).await {
            Ok(a) => a,
            Err(err) => {
                return Ok(Box::new(::warp::reply::with_status(
                    err.to_string().clone(),
                    ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                )));
            }
        };
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

    let mut result =
        crate::protocol::ResultEventsAndRelatedEventsAndCursor::new();

    /*
    result
        .related_events
        .append(&mut processed_events.related_events);

    result
        .result_events
        .append(&mut processed_events.result_events);
    */

    let result_serialized = match result.write_to_bytes() {
        Ok(a) => a,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
