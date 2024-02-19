use ::anyhow::Context;
use ::protobuf::Message;
use ::regex::Regex;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let request = crate::warp_try_err_400!(
        crate::protocol::ClaimHandleRequest::parse_from_tokio_bytes(&bytes)
    );

    let system =
        crate::warp_try_err_400!(crate::model::public_key::from_proto(
            crate::warp_try_err_400!(&request
                .system
                .clone()
                .into_option()
                .context("expected system"))
        ));

    let handle: String = request.handle.clone();

    if handle.len() > 64 || handle.is_empty() {
        return Ok(Box::new(::warp::reply::with_status(
            "Handle must be between 1 and 64 characters",
            ::warp::http::StatusCode::BAD_REQUEST,
        )));
    }

    let re = crate::warp_try_err_500!(Regex::new(r"[^a-zA-Z0-9-_]+"));
    if re.is_match(handle.as_str()) {
        return Ok(Box::new(::warp::reply::with_status(
            "Handle may only have uppercase and lowercase letters, numbers, dashes, and underscores",
            ::warp::http::StatusCode::BAD_REQUEST,
        )));
    }

    let mut transaction = crate::warp_try_err_500!(state.pool.begin().await);

    crate::warp_try_err_500!(
        crate::postgres::claim_handle(&mut transaction, handle, &system).await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    Ok(Box::new(::warp::reply::with_status(
        "",
        ::warp::http::StatusCode::OK,
    )))
}
