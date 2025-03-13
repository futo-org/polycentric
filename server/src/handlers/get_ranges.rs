use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(
        deserialize_with = "polycentric_protocol::model::public_key::serde_url_deserialize"
    )]
    system: polycentric_protocol::model::public_key::PublicKey,
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let result = crate::warp_try_err_500!(
        crate::postgres::known_ranges_for_system(
            &mut transaction,
            &query.system,
        )
        .await
    );

    // let tags: Vec<String> = crate::cache::util::key_to_cache_tags_account_meta(
    //     &query.system,
    // );

    crate::warp_try_err_500!(transaction.commit().await);

    let result_serialized = crate::warp_try_err_500!(result.write_to_bytes());

    let response = ::warp::reply::with_header(
        ::warp::reply::with_status(
            result_serialized,
            ::warp::http::StatusCode::OK,
        ),
        "Cache-Control",
        "no-cache",
    );

    // Caching for ranges is hard because we need nearly strong consistency for caching
    // It's currently not implemented, but should be able to using key_to_cache_tags_account_meta
    Ok(Box::new(response))
}
