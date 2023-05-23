use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(deserialize_with = "deserialize_query")]
    query: crate::protocol::QueryReferencesRequest,
}

fn deserialize_query<'de, D>(
    deserializer: D,
) -> Result<crate::protocol::QueryReferencesRequest, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    let proto =
        crate::protocol::QueryReferencesRequest::parse_from_tokio_bytes(
            &::bytes::Bytes::from(bytes),
        )
        .map_err(::serde::de::Error::custom)?;

    Ok(proto)
}

pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::warp::Rejection> {
    let reference = crate::warp_try_err_500!(
        crate::model::reference::from_proto(&query.query.reference,)
    );

    let mut transaction = crate::warp_try_err_500!(state.pool.begin().await);

    let mut result = crate::protocol::QueryReferencesResponse::new();

    let query_cursor = if let Some(cursor) = query.query.cursor {
        Some(u64::from_be_bytes(crate::warp_try_err_500!(cursor
            .as_slice()
            .try_into())))
    } else {
        None
    };

    let query_result = crate::warp_try_err_500!(
        crate::queries::query_references::query_references(
            &mut transaction,
            &reference,
            &query.query.from_type,
            &query_cursor,
        )
        .await
    );

    if let Some(query_result_cursor) = query_result.cursor {
        result.cursor = Some(query_result_cursor.to_be_bytes().to_vec());
    }

    for signed_event in query_result.events.iter() {
        let event = crate::warp_try_err_500!(crate::model::event::from_vec(
            signed_event.event()
        ));

        let mut item = crate::protocol::QueryReferencesResponseItem::new();

        item.event = ::protobuf::MessageField::some(
            crate::model::signed_event::to_proto(signed_event),
        );

        for params in query.query.count_lww_element_references.iter() {
            item.counts.push(crate::warp_try_err_500!(
                    crate::queries::count_lww_element_references::
                        count_lww_element_references(
                            &mut transaction,
                            &event.system(),
                            &event.process(),
                            *event.logical_clock(),
                            &params.value,
                            &params.from_type,
                        ).await
                ));
        }

        for params in query.query.count_references.iter() {
            item.counts.push(crate::warp_try_err_500!(
                crate::queries::count_references::count_references_pointer(
                    &mut transaction,
                    &event.system(),
                    &event.process(),
                    *event.logical_clock(),
                    &params.from_type,
                )
                .await
            ));
        }

        result.items.push(item);
    }

    crate::warp_try_err_500!(transaction.commit().await);

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
