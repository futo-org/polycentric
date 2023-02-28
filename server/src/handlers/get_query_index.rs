use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    system: crate::model::public_key::PublicKey,
    #[serde(
        deserialize_with = "crate::model::serde_url_deserialize_repeated_uint64"
    )]
    event_types: crate::protocol::RepeatedUInt64,
    limit: ::core::option::Option<u64>,
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

    let processes = match crate::postgres::load_processes_for_system(
        &mut transaction,
        &query.system,
    ).await {
        Ok(x) => x,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    let mut result = crate::protocol::Events::new();

    for process in processes.iter() {
        for event_type in query.event_types.numbers.iter() {
            let batch = match crate::postgres::load_latest_event_by_type(
                &mut transaction,
                &query.system,
                process,
                *event_type,
                query.limit.unwrap_or(1),
            ).await {
                Ok(x) => x,
                Err(err) => {
                    return Ok(Box::new(::warp::reply::with_status(
                        err.to_string().clone(),
                        ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                    )));
                }
            };

            for event in batch.iter() {
                result.events.push(
                    crate::model::signed_event::to_proto(event),
                );
            }
        }
    }

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
