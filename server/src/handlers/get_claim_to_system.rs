use ::anyhow::Context;
use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(deserialize_with = "crate::model::claim::serde_url_deserialize")]
    claim: crate::model::claim::Claim,
    #[serde(
        deserialize_with = "crate::model::public_key::serde_url_deserialize"
    )]
    trust_root: crate::model::public_key::PublicKey,
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

    let mut result = crate::protocol::Events::new();

    result.events = match crate::postgres::find_claims(
        &mut transaction,
        &query.claim,
        &query.trust_root,
    )
    .await
    {
        Ok(x) => x,
        Err(err) => {
            return Ok(Box::new(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }
    }
    .iter()
    .map(|x| crate::model::signed_event::to_proto(x))
    .collect();

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
