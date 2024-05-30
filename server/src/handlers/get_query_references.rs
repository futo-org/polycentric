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
) -> Result<Box<dyn ::warp::Reply>, ::std::convert::Infallible> {
    let reference = crate::warp_try_err_400!(
        crate::model::reference::from_proto(&query.query.reference,)
    );

    let subject = match &reference {
        crate::model::reference::Reference::Pointer(pointer) => {
            if !query.query.extra_byte_references.is_empty() {
                return Ok(Box::new(::warp::reply::with_status(
                    "cannot use extra_byte_references with pointer reference",
                    ::warp::http::StatusCode::BAD_REQUEST,
                )));
            }

            crate::model::PointerOrByteReferences::Pointer(pointer.clone())
        }
        crate::model::reference::Reference::Bytes(primary_reference) => {
            let mut byte_references = query.query.extra_byte_references.clone();
            byte_references.push(primary_reference.clone());
            crate::model::PointerOrByteReferences::Bytes(byte_references)
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

    let mut client = crate::warp_try_err_500!(state.deadpool_write.get().await);

    let transaction = crate::warp_try_err_500!(client.transaction().await);

    let mut result = crate::protocol::QueryReferencesResponse::new();

    let mut count_lww_pointer_input = vec![];
    let mut count_lww_bytes_input = vec![];
    let mut count_pointer_input = vec![];
    let mut count_bytes_input = vec![];

    if let Some(request_events) = &query.query.request_events.0 {
        let query_result = crate::warp_try_err_500!(
            crate::queries::select_references::select(
                &transaction,
                &subject,
                &request_events.from_type,
                &query_cursor,
                20,
            )
            .await
        );

        if let Some(query_result_cursor) = query_result.cursor {
            result.cursor = Some(query_result_cursor.to_be_bytes().to_vec());
        }

        for signed_event in query_result.events.iter() {
            let event = crate::warp_try_err_500!(
                crate::model::event::from_vec(signed_event.event())
            );

            let mut item =
                crate::protocol::QueryReferencesResponseEventItem::new();

            item.event = ::protobuf::MessageField::some(
                crate::model::signed_event::to_proto(signed_event),
            );

            for params in request_events.count_lww_element_references.iter() {
                count_lww_pointer_input.push(
                    crate::queries::select_count_references_lww_element::InputRowPointer{
                        subject: crate::warp_try_err_500!(
                            crate::model::pointer::from_signed_event(&signed_event)
                        ),
                        value: params.value.clone(),
                        from_type: params.from_type.clone(),
                    },
                );
            }

            for params in request_events.count_references.iter() {
                count_pointer_input.push(
                    crate::queries::select_count_references::InputRowPointer {
                        subject: crate::warp_try_err_500!(
                            crate::model::pointer::from_signed_event(
                                &signed_event
                            )
                        ),
                        from_type: params.from_type.clone(),
                    },
                );
            }

            result.items.push(item);
        }
    }

    for params in query.query.count_lww_element_references.iter() {
        match &subject {
            crate::model::PointerOrByteReferences::Pointer(pointer) => {
                count_lww_pointer_input.push(
                    crate::queries::select_count_references_lww_element::InputRowPointer{
                        subject: pointer.clone(),
                        value: params.value.clone(),
                        from_type: params.from_type.clone(),
                    },
                );
            }
            crate::model::PointerOrByteReferences::Bytes(bytes) => {
                count_lww_bytes_input.push(
                    crate::queries::select_count_references_lww_element::InputRowBytes {
                        subject: bytes.clone(),
                        value: params.value.clone(),
                        from_type: params.from_type.clone(),
                    },
                );
            }
        };
    }

    for params in query.query.count_references.iter() {
        match &subject {
            crate::model::PointerOrByteReferences::Pointer(pointer) => {
                count_pointer_input.push(
                    crate::queries::select_count_references::InputRowPointer {
                        subject: pointer.clone(),
                        from_type: params.from_type.clone(),
                    },
                );
            }
            crate::model::PointerOrByteReferences::Bytes(bytes) => {
                count_bytes_input.push(
                    crate::queries::select_count_references::InputRowBytes {
                        subject: bytes.clone(),
                        from_type: params.from_type.clone(),
                    },
                );
            }
        };
    }

    let pointer_counts = crate::warp_try_err_500!(
        crate::queries::select_count_references::select_pointer(
            &transaction,
            count_pointer_input,
        )
        .await
    );

    let bytes_counts = crate::warp_try_err_500!(
        crate::queries::select_count_references::select_bytes(
            &transaction,
            &count_bytes_input,
        )
        .await
    );

    let lww_pointer_counts = crate::warp_try_err_500!(
        crate::queries::select_count_references_lww_element::select_pointer(
            &transaction,
            count_lww_pointer_input,
        )
        .await
    );

    let lww_bytes_counts = crate::warp_try_err_500!(
        crate::queries::select_count_references_lww_element::select_bytes(
            &transaction,
            &count_lww_bytes_input,
        )
        .await
    );

    crate::warp_try_err_500!(transaction.commit().await);

    let mut lww_pointer_counts_position = 0;
    let mut lww_bytes_counts_position = 0;
    let mut pointer_counts_position = 0;
    let mut bytes_counts_position = 0;

    if let Some(request_events) = query.query.request_events.0 {
        for item in result.items.iter_mut() {
            for _ in request_events.count_lww_element_references.iter() {
                item.counts
                    .push(lww_pointer_counts[lww_pointer_counts_position]);
                lww_pointer_counts_position += 1;
            }

            for _ in request_events.count_references.iter() {
                item.counts.push(pointer_counts[pointer_counts_position]);
                pointer_counts_position += 1;
            }
        }
    }

    for params in query.query.count_lww_element_references.iter() {
        match &subject {
            crate::model::PointerOrByteReferences::Pointer(_) => {
                result
                    .counts
                    .push(lww_pointer_counts[lww_pointer_counts_position]);
                lww_pointer_counts_position += 1;
            }
            crate::model::PointerOrByteReferences::Bytes(_) => {
                result
                    .counts
                    .push(lww_bytes_counts[lww_bytes_counts_position]);
                lww_bytes_counts_position += 1;
            }
        };
    }

    for params in query.query.count_references.iter() {
        match &subject {
            crate::model::PointerOrByteReferences::Pointer(_) => {
                result.counts.push(pointer_counts[pointer_counts_position]);
                pointer_counts_position += 1;
            }
            crate::model::PointerOrByteReferences::Bytes(_) => {
                result.counts.push(bytes_counts[bytes_counts_position]);
                bytes_counts_position += 1;
            }
        };
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
