use ::anyhow::Context;
use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(deserialize_with = "serde_url_deserialize")]
    query: Request,
}

struct Request {
    claim_type: u64,
    trust_root: crate::model::public_key::PublicKey,
    match_any_field: ::std::option::Option<String>,
}

fn request_from_proto(
    proto: &crate::protocol::QueryClaimToSystemRequest,
) -> ::anyhow::Result<Request> {
    Ok(Request {
        claim_type: proto.claim_type,
        trust_root: crate::model::public_key::from_proto(&proto.trust_root)?,
        match_any_field: proto.match_any_field.clone(),
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
        crate::protocol::QueryClaimToSystemRequest::parse_from_tokio_bytes(
            &::bytes::Bytes::from(bytes),
        )
        .map_err(::serde::de::Error::custom)?;

    request_from_proto(&proto).map_err(::serde::de::Error::custom)
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let match_any_field = crate::warp_try_err_500!(query
        .query
        .match_any_field
        .context("query not provided"));

    let mut transaction = crate::warp_try_err_500!(state.pool.begin().await);

    let matches = crate::warp_try_err_500!(
        crate::queries::query_claims::query_claims(
            &mut transaction,
            query.query.claim_type,
            &query.query.trust_root,
            &match_any_field,
        )
        .await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    let mut result = crate::protocol::QueryClaimToSystemResponse::new();

    for match_item in matches.iter() {
        let mut item = crate::protocol::QueryClaimToSystemResponseMatch::new();

        item.claim = ::protobuf::MessageField::some(
            crate::model::signed_event::to_proto(&match_item.claim),
        );

        for vouch_item in match_item.path.iter() {
            item.proof_chain
                .push(crate::model::signed_event::to_proto(vouch_item));
        }

        result.matches.push(item);
    }

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, max-age=30",
    )))
}
