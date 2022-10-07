use ::log::*;
use ::protobuf::Message;
use ::serde_json::json;
use ::warp::Filter;

mod crypto;
mod user;

#[derive(Debug)]
enum RequestError {
    ParsingFailed,
    SerializationFailed,
    DatabaseFailed,
}

#[derive(::serde::Serialize, ::serde::Deserialize)]
struct ClockEntry {
    writer_id: ::std::vec::Vec<u8>,
    sequence_number: u64,
}

impl ::warp::reject::Reject for RequestError {}

struct State {
    pool: ::sqlx::PgPool,
    search: ::opensearch::OpenSearch,
}

async fn handle_rejection(
    err: ::warp::Rejection,
) -> Result<impl ::warp::Reply, ::std::convert::Infallible> {
    warn!("rejection {:?}", err);

    Ok(::warp::reply::with_status(
        "INTERNAL_SERVER_ERROR",
        ::warp::http::StatusCode::INTERNAL_SERVER_ERROR,
    ))
}

async fn post_events_handler(
    state: ::std::sync::Arc<State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    let events = crate::user::Events::parse_from_tokio_bytes(&bytes)
        .map_err(|_| RequestError::ParsingFailed)?;

    let query = "
        INSERT INTO events
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING;
    ";

    let query_with_pointer = "
        INSERT INTO events
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ROW($9, $10, $11))
        ON CONFLICT (author_public_key, writer_id, sequence_number)
        DO UPDATE SET
            unix_milliseconds = EXCLUDED.unix_milliseconds,
            content = EXCLUDED.content,
            signature = EXCLUDED.signature,
            clocks = EXCLUDED.clocks,
            event_type = EXCLUDED.event_type,
            mutation_pointer = EXCLUDED.mutation_pointer
        ;
    ";

    for event in &events.events {
        if !crate::crypto::validate_signature(event) {
            warn!("failed to validate signature");
            // return Err(warp::reject::custom(RequestError::SignatureFailed));
            continue;
        }

        let mut message_type: i64 = 0;

        let event_body =
            crate::user::EventBody::parse_from_bytes(&event.content)
                .map_err(|_| RequestError::ParsingFailed)?;

        if event_body.has_profile() {
            message_type = 2;
        } else if event_body.has_delete() {
            message_type = 6;
        }

        let mut converted_clocks = vec![];

        for clock in &event.clocks {
            converted_clocks.push(ClockEntry {
                writer_id: clock.key.clone(),
                sequence_number: clock.value,
            });
        }

        let clocks_serialized = ::serde_json::to_string(&converted_clocks)
            .map_err(|_| RequestError::SerializationFailed)?;

        ::sqlx::query(query)
            .bind(event.author_public_key.clone())
            .bind(event.writer_id.clone())
            .bind(event.sequence_number as i64)
            .bind(event.unix_milliseconds as i64)
            .bind(event.content.clone())
            .bind(event.signature.clone())
            .bind(clocks_serialized)
            .bind(message_type)
            .execute(&state.pool)
            .await
            .map_err(|_| RequestError::DatabaseFailed)?;

        if event_body.has_message() {
            let author_public_key = ::base64::encode(&event.author_public_key);
            let writer_id = ::base64::encode(&event.writer_id);
            let sequence_number = event.sequence_number.to_string();

            let key = format!(
                "{}{}{}",
                author_public_key, writer_id, sequence_number,
            );

            let mut body = OpenSearchSearchDocumentMessage {
                author_public_key: author_public_key,
                writer_id: writer_id,
                sequence_number: event.sequence_number as i64,
                message: None,
            };

            body.message = Some(
                ::std::str::from_utf8(&event_body.message().message)
                    .unwrap()
                    .to_string(),
            );

            let response = state
                .search
                .index(::opensearch::IndexParts::IndexId("posts", &key))
                .body(body)
                .send()
                .await
                .map_err(|_| RequestError::DatabaseFailed)?;

            let err = response.exception().await.unwrap();

            if let Some(body) = err {
                warn!("body {:?}", body);
            }
        }

        if event_body.has_profile() {
            let key = ::base64::encode(&event.author_public_key);
            let writer_id = ::base64::encode(&event.writer_id);

            let mut body = OpenSearchSearchDocumentProfile {
                author_public_key: key.clone(),
                writer_id: writer_id,
                sequence_number: event.sequence_number as i64,
                profile_name: "".to_string(),
                profile_description: None,
                unix_milliseconds: event.unix_milliseconds,
            };

            body.profile_name =
                ::std::str::from_utf8(&event_body.profile().profile_name)
                    .unwrap()
                    .to_string();

            if let Some(description) = &event_body.profile().profile_description
            {
                body.profile_description = Some(
                    ::std::str::from_utf8(description).unwrap().to_string(),
                );
            }

            let script = r#"
                if (ctx.op == "create") {
                    ctx._source = params
                } else if (ctx._source.unix_milliseconds > params.unix_milliseconds) {
                    ctx.op = 'noop'
                } else {
                    ctx._source = params
                }
            "#;

            let response = state
                .search
                .update(::opensearch::UpdateParts::IndexId("profiles", &key))
                .body(json!({
                    "scripted_upsert": true,
                    "script": {
                        "lang": "painless",
                        "params": body,
                        "inline": script,
                    },
                    "upsert": {}
                }))
                .send()
                .await
                .map_err(|_| RequestError::DatabaseFailed)?;

            let err = response.exception().await.unwrap();

            if let Some(body) = err {
                warn!("body {:?}", body);
            }
        }

        if event_body.has_delete() {
            sqlx::query(query_with_pointer)
                .bind(event_body.delete().pointer.public_key.clone())
                .bind(event_body.delete().pointer.writer_id.clone())
                .bind(event_body.delete().pointer.sequence_number as i64)
                .bind(0)
                .bind::<::std::vec::Vec<u8>>(vec![])
                .bind::<::std::vec::Vec<u8>>(vec![])
                .bind("")
                .bind(10)
                .bind(event.author_public_key.clone())
                .bind(event.writer_id.clone())
                .bind(event.sequence_number as i64)
                .execute(&state.pool)
                .await
                .map_err(|err| {
                    error!("upsert with pointer {}", err);
                    RequestError::DatabaseFailed
                })?;
        }
    }

    Ok(::warp::reply::with_status("", ::warp::http::StatusCode::OK))
}

#[derive(sqlx::FromRow)]
struct WriterAndLargest {
    writer_id: ::std::vec::Vec<u8>,
    largest_sequence_number: i64,
}

#[derive(sqlx::FromRow)]
struct StartAndEnd {
    start_number: i64,
    end_number: i64,
}

#[derive(sqlx::FromRow)]
struct PublicKeyRow {
    author_public_key: ::std::vec::Vec<u8>,
}

#[derive(sqlx::Type)]
#[sqlx(type_name = "pointer")]
struct Pointer {
    writer_id: ::std::vec::Vec<u8>,
    public_key: ::std::vec::Vec<u8>,
    sequence_number: i64,
}

#[derive(sqlx::FromRow)]
struct EventRow {
    writer_id: ::std::vec::Vec<u8>,
    author_public_key: ::std::vec::Vec<u8>,
    sequence_number: i64,
    unix_milliseconds: i64,
    content: ::std::vec::Vec<u8>,
    signature: ::std::vec::Vec<u8>,
    clocks: String,
    mutation_pointer: Option<Pointer>,
}

fn event_row_to_event_proto(row: EventRow) -> user::Event {
    let mut event = crate::user::Event::new();
    event.writer_id = row.writer_id;
    event.author_public_key = row.author_public_key;
    event.sequence_number = row.sequence_number as u64;
    event.unix_milliseconds = row.unix_milliseconds as u64;
    event.content = row.content;
    event.signature = Some(row.signature);

    let clocks_deserialized: ::std::vec::Vec<ClockEntry> =
        ::serde_json::from_str(&row.clocks).unwrap();

    for clock in clocks_deserialized {
        let mut proto_clock = crate::user::EventClockEntry::new();
        proto_clock.key = clock.writer_id.clone();
        proto_clock.value = clock.sequence_number;
        event.clocks.push(proto_clock);
    }

    event
}

async fn known_ranges_for_feed_handler(
    state: ::std::sync::Arc<State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    const WRITERS_FOR_FEED_STATEMENT: &str = "
        SELECT writer_id, max(sequence_number) as largest_sequence_number
        FROM events
        WHERE author_public_key = $1
        GROUP BY writer_id;
    ";

    const RANGES_FOR_WRITER_STATEMENT: &str = "
        SELECT
            MIN(sequence_number) as start_number,
            MAX(sequence_number) as end_number
        FROM (
            SELECT *, ROW_NUMBER() OVER(ORDER BY sequence_number) as rn
            FROM events
            WHERE author_public_key = $1
            AND writer_id = $2
        ) t
        GROUP BY sequence_number - rn;
    ";

    let request =
        crate::user::RequestKnownRangesForFeed::parse_from_tokio_bytes(&bytes)
            .map_err(|err| {
                error!("{}", err);
                RequestError::ParsingFailed
            })?;

    let writers_for_feed_rows =
        ::sqlx::query_as::<_, WriterAndLargest>(WRITERS_FOR_FEED_STATEMENT)
            .bind(&request.public_key)
            .fetch_all(&state.pool)
            .await
            .map_err(|err| {
                error!("writers_for_feed {}", err);
                RequestError::DatabaseFailed
            })?;

    let mut result = crate::user::ResponseKnownRangesForFeed::default();

    for writers_for_feed_row in writers_for_feed_rows {
        let mut writer_and_ranges = crate::user::WriterAndRanges::new();
        writer_and_ranges.writer_id = writers_for_feed_row.writer_id.clone();

        let ranges_for_writer_rows =
            ::sqlx::query_as::<_, StartAndEnd>(RANGES_FOR_WRITER_STATEMENT)
                .bind(&request.public_key)
                .bind(writers_for_feed_row.writer_id)
                .fetch_all(&state.pool)
                .await
                .map_err(|err| {
                    error!("ranges_for_writers {}", err);
                    RequestError::DatabaseFailed
                })?;

        for ranges_for_writer_row in ranges_for_writer_rows {
            let mut range = crate::user::Range::new();
            range.low = ranges_for_writer_row.start_number as u64;
            range.high = ranges_for_writer_row.end_number as u64;
            writer_and_ranges.ranges.push(range);
        }

        result.writers.push(writer_and_ranges);
    }

    let result_serialized = result
        .write_to_bytes()
        .map_err(|_| RequestError::SerializationFailed)?;

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}

async fn known_ranges_handler(
    state: ::std::sync::Arc<State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    const RANGES_FOR_WRITER_STATEMENT: &str = "
        SELECT
            MIN(sequence_number) as start_number,
            MAX(sequence_number) as end_number
        FROM (
            SELECT *, ROW_NUMBER() OVER(ORDER BY sequence_number) as rn
            FROM events
            WHERE author_public_key = $1
            AND writer_id = $2
        ) t
        GROUP BY sequence_number - rn;
    ";

    let request =
        crate::user::RequestKnownRanges::parse_from_tokio_bytes(&bytes)
            .map_err(|_| RequestError::ParsingFailed)?;

    let mut known_ranges = crate::user::KnownRanges::new();

    let ranges_for_writer_rows =
        ::sqlx::query_as::<_, StartAndEnd>(RANGES_FOR_WRITER_STATEMENT)
            .bind(&request.author_public_key)
            .bind(&request.writer_id)
            .fetch_all(&state.pool)
            .await
            .map_err(|err| {
                error!("ranges_for_writers {}", err);
                RequestError::DatabaseFailed
            })?;

    for ranges_for_writer_row in ranges_for_writer_rows {
        let mut range = crate::user::Range::new();
        range.low = ranges_for_writer_row.start_number as u64;
        range.high = ranges_for_writer_row.end_number as u64;
        known_ranges.ranges.push(range);
    }

    let result_serialized = known_ranges
        .write_to_bytes()
        .map_err(|_| RequestError::SerializationFailed)?;

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}

async fn maybe_add_profile(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    result: &mut ::std::vec::Vec<crate::user::Event>,
    profile_keys: &mut ::std::collections::HashSet<::std::vec::Vec<u8>>,
    public_key: &::std::vec::Vec<u8>,
) -> Result<(), ::warp::Rejection> {
    const NEWEST_PROFILE_QUERY_STATEMENT: &str = "
        SELECT * FROM events
        WHERE author_public_key = $1
        AND event_type = 2
        ORDER BY unix_milliseconds DESC
        LIMIT 1;
    ";

    if !profile_keys.contains(public_key) {
        let newest_profile_query_row =
            ::sqlx::query_as::<_, EventRow>(NEWEST_PROFILE_QUERY_STATEMENT)
                .bind(public_key)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|err| {
                    error!("newest_profile_query {}", err);
                    RequestError::DatabaseFailed
                })?;

        if let Some(row) = newest_profile_query_row {
            let event = event_row_to_event_proto(row);
            result.push(event);
        }

        profile_keys.insert(public_key.clone());
    }

    Ok(())
}

struct ProcessMutationsResult {
    related_events: ::std::vec::Vec<user::Event>,
    result_events: ::std::vec::Vec<user::Event>,
}

async fn process_mutations(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    history: ::std::vec::Vec<EventRow>,
) -> Result<ProcessMutationsResult, ::warp::Rejection> {
    let mut result = ProcessMutationsResult {
        related_events: vec![],
        result_events: vec![],
    };

    let mut profile_keys =
        ::std::collections::HashSet::<::std::vec::Vec<u8>>::new();

    for row in history {
        maybe_add_profile(
            &mut *transaction,
            &mut result.related_events,
            &mut profile_keys,
            &row.author_public_key,
        )
        .await?;

        if let Some(mutation_pointer) = &row.mutation_pointer {
            info!("got mutation pointer");

            let mutation = get_specific_event(
                &mut *transaction,
                mutation_pointer.public_key.clone(),
                mutation_pointer.writer_id.clone(),
                mutation_pointer.sequence_number.try_into().unwrap(),
            )
            .await
            .map_err(|_| {
                error!("loading mutation");
                RequestError::DatabaseFailed
            })?;

            if let Some(event) = &mutation {
                result.result_events.push(event.clone());
            }
        } else {
            info!("did not get mutation pointer");
            let event = event_row_to_event_proto(row);

            let event_body =
                crate::user::EventBody::parse_from_bytes(&event.content)
                    .map_err(|_| RequestError::ParsingFailed)?;

            if event_body.has_follow() {
                maybe_add_profile(
                    &mut *transaction,
                    &mut result.related_events,
                    &mut profile_keys,
                    &event_body.follow().public_key,
                )
                .await?;
            } else if event_body.has_message() {
                if let Some(pointer) =
                    event_body.message().boost_pointer.as_ref()
                {
                    maybe_add_profile(
                        &mut *transaction,
                        &mut result.related_events,
                        &mut profile_keys,
                        &pointer.public_key,
                    )
                    .await?;
                }
            }

            result.result_events.push(event);
        }
    }

    Ok(result)
}

async fn request_event_ranges_handler(
    state: ::std::sync::Arc<State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    const STATEMENT: &str = "
        SELECT *
        FROM events
        WHERE author_public_key = $1
        AND writer_id = $2
        AND sequence_number >= $3
        AND sequence_number <= $4
    ";

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let request =
        crate::user::RequestEventRanges::parse_from_tokio_bytes(&bytes)
            .map_err(|_| RequestError::ParsingFailed)?;

    let mut history: ::std::vec::Vec<EventRow> = vec![];

    for range in &request.ranges {
        let rows = ::sqlx::query_as::<_, EventRow>(STATEMENT)
            .bind(&request.author_public_key)
            .bind(&request.writer_id)
            .bind(range.low as i64)
            .bind(range.high as i64)
            .fetch_all(&mut transaction)
            .await
            .map_err(|_| RequestError::DatabaseFailed)?;

        for row in rows {
            history.push(row);
        }
    }

    let mut result = crate::user::Events::new();

    let mut processed_events = process_mutations(&mut transaction, history)
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    result.events.append(&mut processed_events.related_events);
    result.events.append(&mut processed_events.result_events);

    transaction
        .commit()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let result_serialized = result
        .write_to_bytes()
        .map_err(|_| RequestError::SerializationFailed)?;

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}

#[derive(::serde::Deserialize, ::serde::Serialize)]
struct OpenSearchSearchDocumentMessage {
    author_public_key: String,
    writer_id: String,
    sequence_number: i64,
    message: Option<String>,
}

#[derive(::serde::Deserialize, ::serde::Serialize)]
struct OpenSearchSearchDocumentProfile {
    author_public_key: String,
    writer_id: String,
    sequence_number: i64,
    profile_name: String,
    profile_description: Option<String>,
    unix_milliseconds: u64,
}

#[derive(::serde::Deserialize)]
struct OpenSearchPointer {
    author_public_key: String,
    writer_id: String,
    sequence_number: i64,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchL2 {
    _source: OpenSearchPointer,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchL1 {
    hits: ::std::vec::Vec<OpenSearchSearchL2>,
}

#[derive(::serde::Deserialize)]
struct OpenSearchSearchL0 {
    hits: OpenSearchSearchL1,
}

async fn request_search_handler(
    state: ::std::sync::Arc<State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    let request = crate::user::Search::parse_from_tokio_bytes(&bytes)
        .map_err(|_| RequestError::ParsingFailed)?;

    info!("searching for {}", request.search);

    let response = state
        .search
        .search(::opensearch::SearchParts::Index(&["posts", "profiles"]))
        .body(json!({
            "query": {
                "multi_match": {
                    "query": request.search,
                    "fuzziness": 2,
                    "fields": [
                        "message",
                        "profile_description",
                        "profile_name"
                    ]
                }
            }
        }))
        .send()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let response_body = response
        .json::<OpenSearchSearchL0>()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    const GET_EVENT_STATEMENT: &str = "
        SELECT *
        FROM events
        WHERE author_public_key = $1
        AND writer_id = $2
        AND sequence_number = $3
        LIMIT 1;
    ";

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let mut history: ::std::vec::Vec<EventRow> = vec![];

    for hit in response_body.hits.hits {
        let author_public_key =
            ::base64::decode(hit._source.author_public_key).unwrap();

        let writer_id = ::base64::decode(hit._source.writer_id).unwrap();

        let sequence_number = hit._source.sequence_number;

        let event_query_rows =
            ::sqlx::query_as::<_, EventRow>(GET_EVENT_STATEMENT)
                .bind(author_public_key)
                .bind(writer_id)
                .bind(sequence_number)
                .fetch_all(&mut transaction)
                .await
                .map_err(|err| {
                    error!("event_query_statement {}", err);
                    RequestError::DatabaseFailed
                })?;

        for row in event_query_rows {
            history.push(row);
        }
    }

    let mut result = crate::user::ResponseSearch::new();

    let mut processed_events = process_mutations(&mut transaction, history)
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    result
        .related_events
        .append(&mut processed_events.related_events);
    result
        .result_events
        .append(&mut processed_events.result_events);

    transaction
        .commit()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let result_serialized = result
        .write_to_bytes()
        .map_err(|_| RequestError::SerializationFailed)?;

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}

async fn request_events_head_handler(
    state: ::std::sync::Arc<State>,
    bytes: ::bytes::Bytes,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    const WRITER_HEADS_QUERY_STATEMENT: &str = "
        SELECT writer_id, max(sequence_number) as largest_sequence_number
        FROM events
        WHERE author_public_key = $1
        GROUP BY writer_id;
    ";

    const EVENTS_FOR_WRITER_QUERY_STATEMENT: &str = "
        SELECT *
        FROM events
        WHERE author_public_key = $1
        AND writer_id = $2
        AND sequence_number <= $3
        AND sequence_number > $4
        ORDER BY sequence_number DESC
        LIMIT 10;
    ";

    const NEWEST_PROFILE_QUERY_STATEMENT: &str = "
        SELECT * FROM events
        WHERE author_public_key = $1
        AND event_type = 2
        ORDER BY unix_milliseconds DESC
        LIMIT 1;
    ";

    let request =
        crate::user::RequestEventsHead::parse_from_tokio_bytes(&bytes)
            .map_err(|_| RequestError::ParsingFailed)?;

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let newest_profile_query_rows =
        ::sqlx::query_as::<_, EventRow>(NEWEST_PROFILE_QUERY_STATEMENT)
            .bind(&request.author_public_key)
            .fetch_all(&mut transaction)
            .await
            .map_err(|err| {
                error!("newest_profile_query {}", err);
                RequestError::DatabaseFailed
            })?;

    let mut history: ::std::vec::Vec<EventRow> = vec![];

    for row in newest_profile_query_rows {
        history.push(row);
    }

    let writer_heads_query_rows =
        ::sqlx::query_as::<_, WriterAndLargest>(WRITER_HEADS_QUERY_STATEMENT)
            .bind(&request.author_public_key)
            .fetch_all(&mut transaction)
            .await
            .map_err(|err| {
                error!("writer_heads_query {}", err);
                RequestError::DatabaseFailed
            })?;

    for row in &writer_heads_query_rows {
        let mut client_head = 0;

        for clock in &request.clocks {
            if clock.key == row.writer_id {
                client_head = clock.value;

                break;
            }
        }

        if (client_head as i64) < row.largest_sequence_number {
            let events_for_writer_rows = ::sqlx::query_as::<_, EventRow>(
                EVENTS_FOR_WRITER_QUERY_STATEMENT,
            )
            .bind(&request.author_public_key)
            .bind(&row.writer_id)
            .bind(&row.largest_sequence_number)
            .bind(client_head as i64)
            .fetch_all(&mut transaction)
            .await
            .map_err(|err| {
                error!("events_for_writer {}", err);
                RequestError::DatabaseFailed
            })?;

            for row in events_for_writer_rows {
                history.push(row);
            }
        }
    }

    let mut result = crate::user::Events::new();

    let mut processed_events = process_mutations(&mut transaction, history)
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    result.events.append(&mut processed_events.related_events);
    result.events.append(&mut processed_events.result_events);

    transaction
        .commit()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let result_serialized = result
        .write_to_bytes()
        .map_err(|_| RequestError::SerializationFailed)?;

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}

async fn get_specific_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    author_public_key: ::std::vec::Vec<u8>,
    writer_id: ::std::vec::Vec<u8>,
    sequence_number: u64,
) -> Result<Option<crate::user::Event>, ::warp::Rejection> {
    const STATEMENT: &str = "
        SELECT * FROM events
        WHERE author_public_key = $1
        AND writer_id = $2
        AND sequence_number = $3
        LIMIT 1;
    ";

    let potential_row = ::sqlx::query_as::<_, EventRow>(STATEMENT)
        .bind(&author_public_key)
        .bind(&writer_id)
        .bind(sequence_number as i64)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|err| {
            error!("get_specific_event {}", err);
            RequestError::DatabaseFailed
        })?;

    if let Some(row) = potential_row {
        return Ok(Option::Some(event_row_to_event_proto(row)));
    }

    Ok(Option::None)
}

async fn get_profile_image(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    author_public_key: ::std::vec::Vec<u8>,
    writer_id: ::std::vec::Vec<u8>,
    sequence_number: u64,
) -> Result<Vec<crate::user::Event>, ::warp::Rejection> {
    let mut result = vec![];

    let possible_meta = get_specific_event(
        &mut *transaction,
        author_public_key.clone(),
        writer_id.clone(),
        sequence_number,
    )
    .await?;

    if let Some(meta) = possible_meta {
        result.push(meta.clone());

        let meta_body = crate::user::EventBody::parse_from_bytes(&meta.content)
            .map_err(|_| RequestError::ParsingFailed)?;

        if !meta_body.has_blob_meta() {
            warn!("did not have blob meta body");
            return Ok(result);
        }

        for i in 1..=(meta_body.blob_meta().section_count) {
            let possible_section = get_specific_event(
                &mut *transaction,
                author_public_key.clone(),
                writer_id.clone(),
                sequence_number + i,
            )
            .await?;

            if let Some(section) = possible_section {
                let section_body =
                    user::EventBody::parse_from_bytes(&section.content)
                        .map_err(|_| RequestError::ParsingFailed)?;

                if section_body.has_blob_section() {
                    result.push(section.clone());
                } else {
                    warn!("did not have blob section body");
                }
            } else {
                warn!("failed to load section")
            }
        }
    } else {
        warn!("failed to load meta");
    }

    Ok(result)
}

async fn request_recommend_profiles_handler(
    state: ::std::sync::Arc<State>,
) -> Result<impl ::warp::Reply, ::warp::Rejection> {
    const RANDOM_USERS_QUERY_STATEMENT: &str = "
        SELECT * FROM (
            SELECT DISTINCT(author_public_key) FROM events
        ) t
        ORDER BY RANDOM()
        LIMIT 3;
    ";

    const NEWEST_PROFILE_QUERY_STATEMENT: &str = "
        SELECT * FROM events
        WHERE author_public_key = $1
        AND event_type = 2
        ORDER BY unix_milliseconds DESC
        LIMIT 1;
    ";

    let mut result = crate::user::Events::new();

    let mut transaction = state
        .pool
        .begin()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let random_users_query_rows =
        ::sqlx::query_as::<_, PublicKeyRow>(RANDOM_USERS_QUERY_STATEMENT)
            .fetch_all(&mut transaction)
            .await
            .map_err(|err| {
                error!("random_users_query {}", err);
                RequestError::DatabaseFailed
            })?;

    for random_user_row in &random_users_query_rows {
        let newest_profile_query_row =
            ::sqlx::query_as::<_, EventRow>(NEWEST_PROFILE_QUERY_STATEMENT)
                .bind(&random_user_row.author_public_key)
                .fetch_optional(&mut transaction)
                .await
                .map_err(|err| {
                    error!("newest_profile_query {}", err);
                    RequestError::DatabaseFailed
                })?;

        if let Some(row) = newest_profile_query_row {
            let event = event_row_to_event_proto(row);
            result.events.push(event.clone());

            let event_body =
                crate::user::EventBody::parse_from_bytes(&event.content)
                    .map_err(|_| RequestError::ParsingFailed)?;

            if event_body.has_profile() {
                if let ::protobuf::MessageField(Some(pointer)) =
                    &event_body.profile().profile_image_pointer
                {
                    let image_events = get_profile_image(
                        &mut transaction,
                        pointer.public_key.clone(),
                        pointer.writer_id.clone(),
                        pointer.sequence_number,
                    )
                    .await?;

                    for image_event in &image_events {
                        result.events.push(image_event.clone());
                    }
                }
            }
        }
    }

    transaction
        .commit()
        .await
        .map_err(|_| RequestError::DatabaseFailed)?;

    let result_serialized = result
        .write_to_bytes()
        .map_err(|_| RequestError::SerializationFailed)?;

    Ok(::warp::reply::with_status(
        result_serialized,
        ::warp::http::StatusCode::OK,
    ))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn ::std::error::Error>> {
    let port = 8081;

    ::env_logger::init();

    info!("Connecting to Postgres");
    let pool = ::sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect("postgres://postgres:testing@postgres")
        .await?;

    let opensearch_transport =
        ::opensearch::http::transport::Transport::single_node(
            "http://opensearch-node1:9200",
        )?;

    let opensearch_client = ::opensearch::OpenSearch::new(opensearch_transport);

    info!("Connecting to OpenSearch");
    // opensearch_client.ping().send().await?;

    let mut transaction = pool.begin().await?;

    ::sqlx::query(
        "
        DO $$ BEGIN
            CREATE TYPE pointer AS (
                public_key      BYTEA,
                writer_id       BYTEA,
                sequence_number INT8
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    ",
    )
    .execute(&mut transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS events (
            author_public_key BYTEA NOT NULL,
            writer_id         BYTEA NOT NULL,
            sequence_number   INT8  NOT NULL,
            unix_milliseconds INT8  NOT NULL,
            content           BYTEA NOT NULL,
            signature         BYTEA NOT NULL,
            clocks            TEXT  NOT NULL,
            event_type        INT8  NOT NULL,
            mutation_pointer  pointer
        );
    ",
    )
    .execute(&mut transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE UNIQUE INDEX IF NOT EXISTS events_index
        ON events (author_public_key, writer_id, sequence_number);
    ",
    )
    .execute(&mut transaction)
    .await?;

    transaction.commit().await?;

    let state = ::std::sync::Arc::new(State {
        pool,
        search: opensearch_client,
    });

    let cors = ::warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type"])
        .allow_methods(&[
            ::warp::http::Method::POST,
            ::warp::http::Method::GET,
        ]);

    let state_filter = ::warp::any().map(move || state.clone());

    let post_events_route = ::warp::post()
        .and(::warp::path("post_events"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(post_events_handler)
        .with(cors.clone());

    let known_ranges_for_feed_route = ::warp::post()
        .and(::warp::path("known_ranges_for_feed"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(known_ranges_for_feed_handler)
        .with(cors.clone());

    let known_ranges_route = ::warp::post()
        .and(::warp::path("known_ranges"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(known_ranges_handler)
        .with(cors.clone());

    let request_event_ranges_route = ::warp::post()
        .and(::warp::path("request_event_ranges"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(request_event_ranges_handler)
        .with(cors.clone());

    let request_events_head_route = ::warp::post()
        .and(::warp::path("head"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(request_events_head_handler)
        .with(cors.clone());

    let request_search_route = ::warp::post()
        .and(::warp::path("search"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and(::warp::body::bytes())
        .and_then(request_search_handler)
        .with(cors.clone());

    let request_recommend_profiles_route = ::warp::get()
        .and(::warp::path("recommended_profiles"))
        .and(::warp::path::end())
        .and(state_filter.clone())
        .and_then(request_recommend_profiles_handler)
        .with(cors.clone());

    let routes = post_events_route
        .or(known_ranges_for_feed_route)
        .or(request_event_ranges_route)
        .or(request_events_head_route)
        .or(known_ranges_route)
        .or(request_search_route)
        .or(request_recommend_profiles_route)
        .recover(handle_rejection);

    info!("Listening on {}", port);
    ::warp::serve(routes).run(([0, 0, 0, 0], port)).await;

    Ok(())
}
