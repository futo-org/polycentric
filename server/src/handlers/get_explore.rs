use ::protobuf::Message;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    /*
    let request =
        crate::protocol::RequestExplore::parse_from_tokio_bytes(&bytes)
            .map_err(|e| {
                crate::RequestError::Anyhow(::anyhow::Error::new(e))
            })?;
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
    let history = crate::postgres::load_events_before_time(
        &mut transaction,
        request.before_time,
    )
    .await
    .map_err(|e| crate::RequestError::Anyhow(e))?;

    let mut processed_events =
        crate::process_mutations2(&mut transaction, history)
            .await
            .map_err(|e| crate::RequestError::Anyhow(e))?;
    */

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
