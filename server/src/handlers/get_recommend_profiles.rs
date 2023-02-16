use ::protobuf::Message;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let mut result = crate::protocol::Events::new();

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
    let random_identities =
        crate::postgres::load_random_identities(&mut transaction)
            .await
            .map_err(|e| crate::RequestError::Anyhow(e))?;

    for random_identity in &random_identities {
        let potential_profile = crate::postgres::load_latest_profile(
            &mut transaction,
            &random_identity,
        )
        .await
        .map_err(|e| crate::RequestError::Anyhow(e))?;

        if let Some(event) = potential_profile {
            let event = crate::model::signed_event_to_protobuf_event(&event);
            result.events.push(event);
        }
    }
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
