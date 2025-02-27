use ::protobuf::Message;

use crate::cache;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(deserialize_with = "serde_url_deserialize")]
    query: Request,
}

enum QueryType {
    MatchAnyField(String),
    MatchAllFields(
        ::std::vec::Vec<polycentric_protocol::protocol::ClaimFieldEntry>,
    ),
}

struct Request {
    claim_type: u64,
    trust_root: polycentric_protocol::model::public_key::PublicKey,
    query: QueryType,
}

fn request_from_proto(
    proto: &polycentric_protocol::protocol::QueryClaimToSystemRequest,
) -> ::anyhow::Result<Request> {
    let query = if proto.has_match_any_field() {
        QueryType::MatchAnyField(proto.match_any_field().to_string())
    } else if proto.has_match_all_fields() {
        QueryType::MatchAllFields(proto.match_all_fields().fields.clone())
    } else {
        ::anyhow::bail!("unknown query type");
    };

    Ok(Request {
        claim_type: proto.claim_type,
        trust_root: polycentric_protocol::model::public_key::from_proto(
            &proto.trust_root,
        )?,
        query,
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
        polycentric_protocol::protocol::QueryClaimToSystemRequest::parse_from_tokio_bytes(
            &::bytes::Bytes::from(bytes),
        )
        .map_err(::serde::de::Error::custom)?;

    request_from_proto(&proto).map_err(::serde::de::Error::custom)
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let matches = crate::warp_try_err_500!(match &query.query.query {
        QueryType::MatchAnyField(value) => {
            crate::postgres::query_claims::query_claims_match_any_field(
                &mut transaction,
                query.query.claim_type,
                &query.query.trust_root,
                value,
            )
            .await
        }
        QueryType::MatchAllFields(fields) => {
            crate::postgres::query_claims::query_claims_match_all_fields(
                &mut transaction,
                query.query.claim_type,
                &query.query.trust_root,
                fields,
            )
            .await
        }
    });

    crate::warp_try_err_500!(transaction.commit().await);

    let mut result =
        polycentric_protocol::protocol::QueryClaimToSystemResponse::new();

    let claim_events: Vec<
        polycentric_protocol::model::signed_event::SignedEvent,
    > = matches.iter().map(|m| m.claim.clone()).collect();
    let claim_cache_tags = cache::util::signed_events_to_cache_tags(
        &claim_events,
        true,
        false,
        false,
        false,
    );

    let vouch_events: Vec<polycentric_protocol::model::signed_event::SignedEvent> =
        matches.iter().flat_map(|m| m.path.iter()).cloned().collect();
    let vouch_cache_tags = cache::util::signed_events_to_cache_tags(
        &vouch_events,
        false,
        false,
        true,
        false,
    );
    let cache_tags = [claim_cache_tags, vouch_cache_tags].concat();

    for match_item in matches.iter() {
        let mut item = polycentric_protocol::protocol::QueryClaimToSystemResponseMatch::new();

        item.claim = ::protobuf::MessageField::some(
            polycentric_protocol::model::signed_event::to_proto(
                &match_item.claim,
            ),
        );

        for vouch_item in match_item.path.iter() {
            item.proof_chain.push(
                polycentric_protocol::model::signed_event::to_proto(vouch_item),
            );
        }

        result.matches.push(item);
    }

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    let response = ::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, s-maxage=3600, max-age=5",
    );

    if !cache_tags.is_empty() {
        if let Some(cache_provider) = state.cache_provider.as_ref() {
            Ok(Box::new(::warp::reply::with_header(
                response,
                cache_provider.get_header_name(),
                cache_provider.get_header_value(&cache_tags),
            )))
        } else {
            Ok(Box::new(response))
        }
    } else {
        Ok(Box::new(response))
    }
}
