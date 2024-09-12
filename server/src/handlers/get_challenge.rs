use ::protobuf::Message;
use ::rand::Rng;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    Ok(crate::warp_try_err_500!(handler_inner(state)))
}

fn handler_inner(
    state: ::std::sync::Arc<crate::State>,
) -> ::anyhow::Result<Box<dyn ::warp::Reply>> {
    let mut body =
        polycentric_protocol::protocol::HarborChallengeResponseBody::new();
    body.challenge = ::rand::thread_rng().gen::<[u8; 32]>().to_vec();
    body.created_on = u64::try_from(
        ::std::time::SystemTime::now()
            .duration_since(::std::time::UNIX_EPOCH)?
            .as_millis(),
    )?;

    let body_bytes = body.write_to_bytes()?;

    let mut challenge_wrapper =
        polycentric_protocol::protocol::HarborChallengeResponse::new();
    challenge_wrapper.hmac = ::hmac_sha256::HMAC::mac(
        body_bytes.clone(),
        state.challenge_key.as_bytes(),
    )
    .to_vec();
    challenge_wrapper.body = body_bytes;

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            challenge_wrapper.write_to_bytes()?,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "no-cache",
    )))
}
