use ::protobuf::Message;
use ::warp::Reply;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(deserialize_with = "serde_url_deserialize")]
    query: Request,
}

struct Request {
    vouching_system: crate::model::public_key::PublicKey,
    claiming_system: crate::model::public_key::PublicKey,
    fields: ::std::vec::Vec<crate::protocol::ClaimFieldEntry>,
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
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    Ok(::std::boxed::Box::new(
        ::warp::reply::json(&::serde_json::json!({
            "placeholder": "placeholder",
        }))
        .into_response(),
    ))
}
