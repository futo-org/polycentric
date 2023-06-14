use ::protobuf::Message;
use std::fmt::Error;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    censorship_type: crate::postgres::CensorshipType,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    authorization: String,
    query: Query,
    bytes: ::bytes::Bytes,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    if authorization != state.admin_token {
        return Ok(Box::new(::warp::reply::with_status(
            String::from(""),
            ::warp::http::StatusCode::UNAUTHORIZED,
        )));
    }

    let url_str = crate::warp_try_err_500!(String::from_utf8(bytes.to_vec()));

    let url = crate::warp_try_err_500!(::url::Url::parse(&url_str));
    let end_base64 = crate::warp_try_err_500!(url
        .path_segments()
        .expect("expected end")
        .last()
        .ok_or(Error));

    let bytes2 = crate::warp_try_err_500!(base64::decode_config(
        end_base64,
        ::base64::URL_SAFE
    ));
    let url_info = crate::warp_try_err_500!(
        crate::protocol::URLInfo::parse_from_bytes(&bytes2)
    );

    let mut transaction = crate::warp_try_err_500!(state.pool.begin().await);

    if url_info.url_type == 1 {
        let body_system = crate::warp_try_err_500!(
            crate::protocol::URLInfoSystemLink::parse_from_bytes(
                &url_info.body
            )
        );
        let system = crate::warp_try_err_500!(crate::model::public_key::from_url_proto(&body_system)); 
        crate::warp_try_err_500!(
            crate::postgres::censor_system(
                &mut transaction,
                query.censorship_type,
                system
            )
            .await
        );
    } else if url_info.url_type == 2 {
        let body_proto = crate::warp_try_err_500!(
            crate::protocol::URLInfoEventLink::parse_from_bytes(&url_info.body)
        );

        let system = crate::warp_try_err_500!(crate::model::public_key::from_proto(&body_proto.system));
        let process = crate::warp_try_err_500!(crate::model::process::from_proto(&body_proto.process));
        let logical_clock = body_proto.logical_clock;

        crate::warp_try_err_500!(
            crate::postgres::censor_event(
                &mut transaction,
                query.censorship_type,
                &system,
                &process,
                logical_clock
            )
            .await
        );
    } else {
        return Ok(Box::new(::warp::reply::with_status(
            String::from("Unknown URL type"),
            ::warp::http::StatusCode::BAD_REQUEST,
        )));
    }

    crate::warp_try_err_500!(transaction.commit().await);

    Ok(Box::new(::warp::reply::with_status(
        String::from(""),
        ::warp::http::StatusCode::OK,
    )))
}
