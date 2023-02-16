use ::anyhow::Context;
use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    censorship_type: crate::postgres::CensorshipType,
}

/*
enum IdentityOrPointer {
    Identity(::ed25519_dalek::PublicKey),
    Pointer(crate::model::pointer::Pointer),
}

fn get_identity_or_pointer(
    bytes: &::bytes::Bytes
) -> ::anyhow::Result<IdentityOrPointer> {
    let url_str = ::std::str::from_utf8(&bytes)?;

    let url = ::url::Url::parse(url_str).map_err(::anyhow::Error::new)?;

    let end_base64 = url.path_segments().expect("expected end").last().unwrap();

    let end_bytes = ::base64::decode_config(
        end_base64,
        ::base64::URL_SAFE
    ).map_err(::anyhow::Error::new)?;

    let parsed = crate::protocol::URLInfo::parse_from_tokio_bytes(
        &::bytes::Bytes::from(end_bytes.clone())
    ).map_err(::anyhow::Error::new)?;

    let identity = ::ed25519_dalek::PublicKey::from_bytes(
        &parsed.public_key,
    ).map_err(::anyhow::Error::new)?;

    if let Some(writer_id) = &parsed.writer_id {
        let writer = crate::model::vec_to_writer_id(
            &writer_id,
        )?;

        let sequence_number = parsed.sequence_number
            .context("expected sequence_number")?;

        let pointer = crate::model::pointer::Pointer::new(
            identity,
            writer,
            sequence_number,
        );

        Ok(IdentityOrPointer::Pointer(pointer))
    } else {
        Ok(IdentityOrPointer::Identity(identity))
    }
}
*/

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    authorization: String,
    query: Query,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    if authorization != state.admin_token {
        return Ok(::warp::reply::with_status(
            String::from(""),
            ::warp::http::StatusCode::UNAUTHORIZED,
        ));
    }

    /*
    let identity_or_pointer = match get_identity_or_pointer(&bytes) {
        Ok(x) => x,
        Err(err) => {
            return Ok(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::BAD_REQUEST,
            ));
        }
    };
    */

    let mut transaction = match state.pool.begin().await {
        Ok(x) => x,
        Err(err) => {
            return Ok(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    };

    /*
    match identity_or_pointer {
        IdentityOrPointer::Pointer(pointer) => {
            match
                crate::postgres::censor_post(
                    &mut transaction,
                    &pointer,
                    query.censorship_type,
                ).await
            {
                Ok(()) => (),
                Err(err) => {
                    return Ok(::warp::reply::with_status(
                        err.to_string().clone(),
                        ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                    ));
                }
            };
        },
        IdentityOrPointer::Identity(identity) => {
            match
                crate::postgres::censor_identity(
                    &mut transaction,
                    &identity,
                    query.censorship_type,
                ).await
            {
                Ok(()) => (),
                Err(err) => {
                    return Ok(::warp::reply::with_status(
                        err.to_string().clone(),
                        ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                    ));
                }
            };
        }
    }
    */

    match transaction.commit().await {
        Ok(()) => (),
        Err(err) => {
            return Ok(::warp::reply::with_status(
                err.to_string().clone(),
                ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    };

    Ok(::warp::reply::with_status(
        String::from(""),
        ::warp::http::StatusCode::OK,
    ))
}
