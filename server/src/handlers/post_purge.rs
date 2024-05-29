use ::anyhow::Context;
use ::protobuf::Message;

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    bytes: ::bytes::Bytes,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let request = crate::warp_try_err_400!(
        crate::protocol::HarborValidateRequest::parse_from_tokio_bytes(&bytes)
    );

    let system =
        crate::warp_try_err_400!(crate::model::public_key::from_proto(
            crate::warp_try_err_400!(&request
                .system
                .clone()
                .into_option()
                .context("expected system"))
        ));

    let request_body = crate::warp_try_err_400!(
        crate::protocol::HarborChallengeResponseBody::parse_from_bytes(
            &request.challenge.body
        )
    );

    crate::warp_try_err_400!(crate::model::public_key::validate_signature(
        &system,
        &request.signature,
        &request_body.challenge,
    ));

    let hmac = ::hmac_sha256::HMAC::mac(
        request.challenge.body.clone(),
        state.challenge_key.as_bytes(),
    )
    .to_vec();

    if !::constant_time_eq::constant_time_eq(&hmac, &request.challenge.hmac) {
        return Ok(Box::new(::warp::reply::with_status(
            "",
            ::warp::http::StatusCode::UNAUTHORIZED,
        )));
    }

    {
        let mut client =
            crate::warp_try_err_500!(state.deadpool_write.get().await);

        let transaction = crate::warp_try_err_500!(client.transaction().await);

        crate::warp_try_err_500!(
            crate::queries::purge::purge(&transaction, &system).await
        );

        crate::warp_try_err_500!(transaction.commit().await);
    }

    Ok(Box::new(::warp::reply::with_status(
        "",
        ::warp::http::StatusCode::OK,
    )))
}
