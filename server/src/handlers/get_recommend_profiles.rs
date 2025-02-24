use ::protobuf::Message;

use crate::moderation::ModerationFilters;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        default,
        deserialize_with = "crate::handlers::util::deserialize_json_string"
    )]
    moderation_filters: ::std::option::Option<ModerationFilters>,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut result = polycentric_protocol::protocol::PublicKeys::new();

    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let random_identities = crate::warp_try_err_500!(
        crate::postgres::load_random_profiles(
            &mut transaction,
            &crate::moderation::ModerationOptions {
                filters: query.moderation_filters,
                mode: crate::config::ModerationMode::Off,
            },
        )
        .await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    for identity in random_identities.iter() {
        result
            .systems
            .push(polycentric_protocol::model::public_key::to_proto(identity));
    }

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    Ok(Box::new(::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "public, s-maxage=3600, max-age=5",
    )))
}
