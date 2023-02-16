use ::log::*;
use ::protobuf::Message;
use ::serde_json::json;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let events = match crate::protocol::Events::parse_from_tokio_bytes(&bytes) {
        Ok(x) => x,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::BAD_REQUEST,
            )));
        }
    };

    let mut transaction = match state.pool.begin().await {
        Ok(x) => x,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    };

    for event in &events.events {
        let validated_event =
            match crate::model::signed_event::from_proto(event) {
                Ok(x) => x,
                Err(err) => {
                    return Ok(Box::new(::warp::reply::with_status(
                        err.to_string().clone(),
                        ::warp::http::StatusCode::BAD_REQUEST,
                    )));
                }
            };

        match crate::ingest::ingest_event(&mut transaction, &validated_event)
            .await
        {
            Ok(()) => (),
            Err(err) => {
                return Ok(Box::new(::warp::reply::with_status(
                    err.to_string().clone(),
                    ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                )));
            }
        }

        /*
        persist_event_notification(&mut transaction, &event, &event_body)
            .await?;

        persist_event_search(state.clone(), &event, &event_body).await?;
        */
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

    Ok(Box::new(::warp::reply::with_status(
        "",
        ::warp::http::StatusCode::OK,
    )))
}
