use crate::moderation::{ModerationFilters, ModerationOptions};
use ::protobuf::Message;

#[derive(::serde::Deserialize)]
pub(crate) struct Query {
    #[serde(deserialize_with = "deserialize_query")]
    query: polycentric_protocol::protocol::QueryReferencesRequest,
    moderation_filters: Option<ModerationFilters>,
}

fn deserialize_query<'de, D>(
    deserializer: D,
) -> Result<polycentric_protocol::protocol::QueryReferencesRequest, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    let string: &str = ::serde::Deserialize::deserialize(deserializer)?;

    let bytes = ::base64::decode_config(string, ::base64::URL_SAFE)
        .map_err(::serde::de::Error::custom)?;

    let proto =
        polycentric_protocol::protocol::QueryReferencesRequest::parse_from_tokio_bytes(
            &::bytes::Bytes::from(bytes),
        )
        .map_err(::serde::de::Error::custom)?;

    Ok(proto)
}
pub(crate) async fn handler(
    state: ::std::sync::Arc<crate::State>,
    query: Query,
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let reference = crate::warp_try_err_400!(
        polycentric_protocol::model::reference::from_proto(
            &query.query.reference,
        )
    );

    let subject = match &reference {
        polycentric_protocol::model::reference::Reference::Pointer(pointer) => {
            if !query.query.extra_byte_references.is_empty() {
                return Ok(Box::new(::warp::reply::with_status(
                    "cannot use extra_byte_references with pointer reference",
                    ::warp::http::StatusCode::BAD_REQUEST,
                )));
            }

            polycentric_protocol::model::PointerOrByteReferences::Pointer(
                pointer.clone(),
            )
        }
        polycentric_protocol::model::reference::Reference::Bytes(
            primary_reference,
        ) => {
            let mut byte_references = query.query.extra_byte_references.clone();
            byte_references.push(primary_reference.clone());
            polycentric_protocol::model::PointerOrByteReferences::Bytes(
                byte_references,
            )
        }
        _ => {
            return Ok(Box::new(::warp::reply::with_status(
                "unsupported reference type",
                ::warp::http::StatusCode::BAD_REQUEST,
            )));
        }
    };

    let query_cursor = if let Some(cursor) = query.query.cursor {
        Some(u64::from_be_bytes(crate::warp_try_err_400!(cursor
            .as_slice()
            .try_into())))
    } else {
        None
    };

    let mut transaction =
        crate::warp_try_err_500!(state.pool_read_only.begin().await);

    let mut result =
        polycentric_protocol::protocol::QueryReferencesResponse::new();

    if let Some(request_events) = query.query.request_events.0 {
        let query_result = crate::warp_try_err_500!(
            crate::postgres::query_references::query_references(
                &mut transaction,
                &subject,
                &request_events.from_type,
                &query_cursor,
                20,
                &ModerationOptions {
                    filters: query.moderation_filters.clone(),
                    mode: state.moderation_mode,
                },
            )
            .await
        );

        if let Some(query_result_cursor) = query_result.cursor {
            result.cursor = Some(query_result_cursor.to_be_bytes().to_vec());
        }

        for signed_event in query_result.events.iter() {
            let event = crate::warp_try_err_500!(
                polycentric_protocol::model::event::from_vec(
                    signed_event.event()
                )
            );

            let mut item =
                polycentric_protocol::protocol::QueryReferencesResponseEventItem::new();

            item.event = ::protobuf::MessageField::some(
                polycentric_protocol::model::signed_event::to_proto(
                    signed_event,
                ),
            );

            for params in request_events.count_lww_element_references.iter() {
                item.counts.push(crate::warp_try_err_500!(
                        crate::postgres::count_lww_element_references::
                            count_lww_element_references_pointer(
                                &mut transaction,
                                event.system(),
                                event.process(),
                                *event.logical_clock(),
                                &params.value,
                                &params.from_type,
                            ).await
                    ));
            }

            for params in request_events.count_references.iter() {
                item.counts.push(crate::warp_try_err_500!(
                    crate::postgres::count_references::count_references_pointer(
                        &mut transaction,
                        event.system(),
                        event.process(),
                        *event.logical_clock(),
                        &params.from_type,
                    )
                    .await
                ));
            }

            result.items.push(item);

            let system = event.system();

            for additional_event in
                query.query.additional_system_lww_content_types.iter()
            {
                let additional_query_result = crate::warp_try_err_500!(
                    crate::postgres::select_latest_by_content_type::select(
                        &mut transaction,
                        system,
                        &additional_event.content_types,
                        &crate::moderation::ModerationOptions {
                            filters: query.moderation_filters.clone(),
                            mode: state.moderation_mode,
                        },
                    )
                    .await
                );

                for signed_event in additional_query_result.iter() {
                    result.related_events.push(
                        polycentric_protocol::model::signed_event::to_proto(
                            signed_event,
                        ),
                    );
                }
            }
        }
    }

    for params in query.query.count_lww_element_references.iter() {
        result.counts.push(crate::warp_try_err_500!(
                crate::postgres::count_lww_element_references::
                    count_lww_element_references(
                        &mut transaction,
                        &subject,
                        &params.value,
                        &params.from_type,
                    ).await
            ));
    }

    for params in query.query.count_references.iter() {
        result.counts.push(crate::warp_try_err_500!(
            crate::postgres::count_references::count_references(
                &mut transaction,
                &subject,
                &params.from_type,
            )
            .await
        ));
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
