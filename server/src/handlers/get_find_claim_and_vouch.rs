use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(deserialize_with = "serde_url_deserialize")]
    query: Request,
}

struct Request {
    vouching_system: crate::model::public_key::PublicKey,
    claiming_system: crate::model::public_key::PublicKey,
    fields: ::std::vec::Vec<crate::protocol::ClaimFieldEntry>,
    claim_type: u64,
}

fn request_from_proto(
    proto: &crate::protocol::FindClaimAndVouchRequest,
) -> ::anyhow::Result<Request> {
    Ok(Request {
        vouching_system: crate::model::public_key::from_proto(
            &proto.vouching_system,
        )?,
        claiming_system: crate::model::public_key::from_proto(
            &proto.claiming_system,
        )?,
        fields: proto.fields.clone(),
        claim_type: proto.claim_type,
    })
}

fn serde_url_deserialize<'de, D>(deserializer: D) -> Result<Request, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    let proto =
        crate::protocol::FindClaimAndVouchRequest::parse_from_tokio_bytes(
            &::bytes::Bytes::from(bytes),
        )
        .map_err(::serde::de::Error::custom)?;

    request_from_proto(&proto).map_err(::serde::de::Error::custom)
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let potential_db_result = crate::warp_try_err_500!(
        crate::postgres::query_find_claim_and_vouch::query_find_claim_and_vouch(
            &mut transaction,
            &query.query.vouching_system,
            &query.query.claiming_system,
            query.query.claim_type,
            &query.query.fields,
        )
        .await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    match potential_db_result {
        Some(db_result) => {
            let mut result = crate::protocol::FindClaimAndVouchResponse::new();

            result.vouch = ::protobuf::MessageField::some(
                crate::model::signed_event::to_proto(&db_result.vouch_event),
            );

            result.claim = ::protobuf::MessageField::some(
                crate::model::signed_event::to_proto(&db_result.claim_event),
            );

            let result_serialized =
                crate::warp_try_err_500!(result.write_to_bytes());

            Ok(Box::new(::warp::reply::with_header(
                ::warp::reply::with_status(
                    result_serialized,
                    ::warp::http::StatusCode::OK,
                ),
                "Cache-Control",
                "public, max-age=30",
            )))
        }
        None => Ok(Box::new(::warp::reply::with_status(
            "pair not found".to_string(),
            ::warp::http::StatusCode::NOT_FOUND,
        ))),
    }
}
