use ::protobuf::Message;
use ::std::convert::TryFrom;

use crate::handlers::get_explore::EventsAndCursor;

#[derive(::sqlx::Type)]
#[sqlx(type_name = "censorship_type")]
#[sqlx(rename_all = "snake_case")]
#[derive(::serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CensorshipType {
    DoNotRecommend,
    RefuseStorage,
}

#[derive(::sqlx::Type)]
#[sqlx(type_name = "link_type")]
#[sqlx(rename_all = "snake_case")]
pub(crate) enum LinkType {
    React,
    Boost,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
struct EventRow {
    #[sqlx(try_from = "i64")]
    id: u64,
    #[sqlx(try_from = "i64")]
    system_key_type: u64,
    system_key: ::std::vec::Vec<u8>,
    process: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    logical_clock: u64,
    #[sqlx(try_from = "i64")]
    content_type: u64,
    content: ::std::vec::Vec<u8>,
    vector_clock: ::std::vec::Vec<u8>,
    indices: ::std::vec::Vec<u8>,
    signature: ::std::vec::Vec<u8>,
    raw_event: ::std::vec::Vec<u8>,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
struct ExploreRow {
    #[sqlx(try_from = "i64")]
    id: u64,
    #[sqlx(try_from = "i64")]
    server_time: u64,
    raw_event: ::std::vec::Vec<u8>,
}

#[allow(dead_code)]
#[derive(PartialEq, Debug, ::sqlx::FromRow)]
struct RangeRow {
    process: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    low: u64,
    #[sqlx(try_from = "i64")]
    high: u64,
}

#[allow(dead_code)]
#[derive(PartialEq, Debug, ::sqlx::FromRow)]
struct SystemRow {
    system_key: ::std::vec::Vec<u8>,
    #[sqlx(try_from = "i64")]
    system_key_type: u64,
}

pub(crate) async fn prepare_database(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::sqlx::Result<()> {
    ::sqlx::query(
        "
        DO $$ BEGIN
            CREATE TYPE censorship_type AS ENUM (
                'do_not_recommend',
                'refuse_storage'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        DO $$ BEGIN
            CREATE TYPE link_type AS ENUM (
                'react',
                'boost'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS events (
            id              BIGSERIAL PRIMARY KEY,
            system_key_type INT8      NOT NULL,
            system_key      BYTEA     NOT NULL,
            process         BYTEA     NOT NULL,
            logical_clock   INT8      NOT NULL,
            content_type    INT8      NOT NULL,
            content         BYTEA     NOT NULL,
            vector_clock    BYTEA     NOT NULL,
            indices         BYTEA     NOT NULL,
            signature       BYTEA     NOT NULL,
            raw_event       BYTEA     NOT NULL,
            server_time     INT8      NOT NULL,

            CHECK ( system_key_type >= 0  ),
            CHECK ( LENGTH(process) =  16 ),
            CHECK ( logical_clock   >= 0  ),
            CHECK ( content_type    >= 0  ),

            UNIQUE (system_key_type, system_key, process, logical_clock)
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS event_links (
            id                      BIGSERIAL PRIMARY KEY,
            subject_system_key_type INT8      NOT NULL,
            subject_system_key      BYTEA     NOT NULL,
            subject_process         BYTEA     NOT NULL,
            subject_logical_clock   INT8      NOT NULL,
            link_content_type       INT8      NOT NULL,
            event_id                BIGSERIAL NOT NULL,

            CHECK ( subject_system_key_type >= 0  ),
            CHECK ( LENGTH(subject_process) =  16 ),
            CHECK ( subject_logical_clock   >= 0  ),
            CHECK ( link_content_type       >= 0  ),

            CONSTRAINT FK_event
                FOREIGN KEY (event_id)
                REFERENCES events(id)
                ON DELETE CASCADE
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS event_references_bytes (
            id                      BIGSERIAL PRIMARY KEY,
            subject_bytes           BYTEA     NOT NULL,
            event_id                BIGSERIAL NOT NULL,

            CONSTRAINT FK_event
                FOREIGN KEY (event_id)
                REFERENCES events(id)
                ON DELETE CASCADE
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS event_indices (
            id            BIGSERIAL PRIMARY KEY,
            index_type    INT8      NOT NULL,
            logical_clock INT8      NOT NULL,
            event_id      BIGSERIAL NOT NULL,

            CHECK ( index_type    >= 0 ),
            CHECK ( logical_clock >= 0 ),

            CONSTRAINT FK_event
                FOREIGN KEY (event_id)
                REFERENCES events(id)
                ON DELETE CASCADE
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS claims (
            id         BIGSERIAL PRIMARY KEY,
            claim_type TEXT      NOT NULL,
            event_id   BIGSERIAL NOT NULL,

            CONSTRAINT FK_event
                FOREIGN KEY (event_id)
                REFERENCES events(id)
                ON DELETE CASCADE
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS lww_elements (
            id                BIGSERIAL PRIMARY KEY,
            unix_milliseconds INT8      NOT NULL,
            value             BYTEA     NOT NULL,
            event_id          BIGSERIAL NOT NULL,

            CHECK ( unix_milliseconds >= 0 ),

            CONSTRAINT FK_event
                FOREIGN KEY (event_id)
                REFERENCES events(id)
                ON DELETE CASCADE
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS process_state (
            id              BIGSERIAL PRIMARY KEY,
            system_key_type INT8      NOT NULL,
            system_key      BYTEA     NOT NULL,
            process         BYTEA     NOT NULL,
            logical_clock   INT8      NOT NULL,

            CHECK ( system_key_type >= 0  ),
            CHECK ( LENGTH(process) =  16 ),
            CHECK ( logical_clock   >= 0  ),

            UNIQUE (system_key_type, system_key, process)
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS deletions (
            id              BIGSERIAL PRIMARY KEY,
            system_key_type INT8      NOT NULL,
            system_key      BYTEA     NOT NULL,
            process         BYTEA     NOT NULL,
            logical_clock   INT8      NOT NULL,
            event_id        BIGSERIAL NOT NULL,

            CHECK ( system_key_type >= 0  ),
            CHECK ( LENGTH(process) =  16 ),
            CHECK ( logical_clock   >= 0  ),
            
            CONSTRAINT FK_event
                FOREIGN KEY (event_id)
                REFERENCES events(id)
                ON DELETE CASCADE
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS censored_events (
            id                BIGSERIAL       PRIMARY KEY,
            system_key_type   INT8            NOT NULL,
            system_key        BYTEA           NOT NULL,
            process           BYTEA           NOT NULL,
            logical_clock     INT8            NOT NULL,
            censorship_type   censorship_type NOT NULL,

            CHECK ( system_key_type >= 0  ),
            CHECK ( LENGTH(process) =  16 ),
            CHECK ( logical_clock   >= 0  ),

            UNIQUE (system_key_type, system_key, process, logical_clock)
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    ::sqlx::query(
        "
        CREATE TABLE IF NOT EXISTS censored_systems (
            id                BIGSERIAL       PRIMARY KEY,
            system_key_type   INT8            NOT NULL,
            system_key        BYTEA           NOT NULL,
            censorship_type   censorship_type NOT NULL,

            CHECK ( system_key_type >= 0  ),

            UNIQUE (system_key_type, system_key)
        );
    ",
    )
    .execute(&mut *transaction)
    .await?;

    Ok(())
}

pub(crate) async fn load_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
) -> ::anyhow::Result<Option<crate::model::signed_event::SignedEvent>> {
    let query = "
        SELECT raw_event FROM events
        WHERE system_key_type = $1
        AND   system_key      = $2
        AND   process         = $3
        AND   logical_clock   = $4
        LIMIT 1;
    ";

    let potential_raw = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(&process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .fetch_optional(&mut *transaction)
        .await?;

    match potential_raw {
        Some(raw) => Ok(Some(crate::model::signed_event::from_proto(
            &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
        )?)),
        None => Ok(None),
    }
}

pub(crate) async fn load_posts_before_id(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    start_id: u64,
) -> ::anyhow::Result<crate::handlers::get_explore::EventsAndCursor> {
    let query = "
        SELECT id, raw_event, server_time FROM events
        WHERE id < $1
        AND content_type = $2
        ORDER BY id DESC
        LIMIT 10;
    ";

    let rows = ::sqlx::query_as::<_, ExploreRow>(query)
        .bind(i64::try_from(start_id)?)
        .bind(i64::try_from(crate::model::known_message_types::POST)?)
        .fetch_all(&mut *transaction)
        .await?;

    let mut result_set = vec![];

    for row in rows.iter() {
        let event = crate::model::signed_event::from_proto(
                &crate::protocol::SignedEvent::parse_from_bytes(&row.raw_event)?,
            )?;
        result_set.push(event);
    }

    let result = EventsAndCursor {
        events: result_set,
        cursor: rows.last().ok_or(::std::fmt::Error)?.id
    };

    return Ok(result);
}

pub(crate) async fn load_processes_for_system(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::process::Process>> {
    let query = "
        SELECT DISTINCT process
        FROM events
        WHERE system_key_type = $1
        AND system_key = $2
    ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .fetch_all(&mut *transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::process::from_vec(&raw)
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::process::Process>,
        >>()
}

pub(crate) async fn load_latest_event_by_type(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    content_type: u64,
    limit: u64,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let query = "
        SELECT raw_event FROM events
        WHERE system_key_type = $1
        AND   system_key      = $2
        AND   process         = $3
        AND   content_type    = $4
        ORDER BY logical_clock DESC
        LIMIT $5;
    ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(&process.bytes())
        .bind(i64::try_from(content_type)?)
        .bind(i64::try_from(limit)?)
        .fetch_all(&mut *transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::signed_event::from_proto(
                &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()
}

pub(crate) async fn load_latest_system_wide_lww_event_by_type(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    content_type: u64,
    limit: u64,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let query = "
        SELECT events.raw_event FROM events 
        INNER JOIN lww_elements 
        ON events.id = lww_elements.event_id 
        WHERE events.system_key_type = $1
        AND   events.system_key      = $2
        AND   events.content_type    = $3
        ORDER BY lww_elements.unix_milliseconds DESC
        LIMIT $4;
    ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(i64::try_from(content_type)?)
        .bind(i64::try_from(limit)?)
        .fetch_all(&mut *transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::signed_event::from_proto(
                &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()
}

pub(crate) async fn does_event_exist(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &crate::model::event::Event,
) -> ::anyhow::Result<bool> {
    let query_select_deleted = "
        SELECT 1 FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        AND process = $3
        AND logical_clock = $4
        LIMIT 1;
    ";

    let does_exist = ::sqlx::query_scalar::<_, i32>(query_select_deleted)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            &event.system(),
        ))?)
        .bind(crate::model::public_key::get_key_bytes(&event.system()))
        .bind(&event.process().bytes())
        .bind(i64::try_from(*event.logical_clock())?)
        .fetch_optional(&mut *transaction)
        .await?;

    Ok(does_exist.is_some())
}

pub(crate) async fn is_event_deleted(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event: &crate::model::event::Event,
) -> ::anyhow::Result<bool> {
    let query_select_deleted = "
        SELECT 1 FROM deletions
        WHERE system_key_type = $1
        AND system_key = $2
        AND process = $3
        AND logical_clock = $4
        LIMIT 1;
    ";

    let is_deleted = ::sqlx::query_scalar::<_, i32>(query_select_deleted)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            &event.system(),
        ))?)
        .bind(crate::model::public_key::get_key_bytes(&event.system()))
        .bind(&event.process().bytes())
        .bind(i64::try_from(*event.logical_clock())?)
        .fetch_optional(&mut *transaction)
        .await?;

    Ok(is_deleted.is_some())
}

pub(crate) async fn delete_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    system: &crate::model::public_key::PublicKey,
    delete: &crate::model::delete::Delete,
) -> ::anyhow::Result<()> {
    let query_insert_delete = "
        INSERT INTO deletions
        (
            system_key_type,
            system_key,
            process,
            logical_clock,
            event_id
        )
        VALUES (
            $1, $2, $3, $4, $5
        );
    ";

    let query_delete_event = "
        DELETE FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        AND process = $3
        AND logical_clock = $4;
    ";

    ::sqlx::query(query_insert_delete)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(delete.process().bytes())
        .bind(i64::try_from(*delete.logical_clock())?)
        .bind(i64::try_from(event_id)?)
        .execute(&mut *transaction)
        .await?;

    ::sqlx::query(query_delete_event)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(delete.process().bytes())
        .bind(i64::try_from(*delete.logical_clock())?)
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    signed_event: &crate::model::signed_event::SignedEvent,
    server_time: u64,
) -> ::anyhow::Result<u64> {
    let query_insert_event = "
        INSERT INTO events
        (
            system_key_type,
            system_key,
            process,
            logical_clock,
            content_type,
            content,
            vector_clock,
            indices,
            signature,
            raw_event,
            server_time
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id;
    ";

    let event = crate::model::event::from_proto(
        &crate::protocol::Event::parse_from_bytes(signed_event.event())?,
    )?;

    let serialized =
        crate::model::signed_event::to_proto(&signed_event).write_to_bytes()?;

    let id = ::sqlx::query_scalar::<_, i64>(query_insert_event)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            &event.system(),
        ))?)
        .bind(crate::model::public_key::get_key_bytes(&event.system()))
        .bind(&event.process().bytes())
        .bind(i64::try_from(*event.logical_clock())?)
        .bind(i64::try_from(*event.content_type())?)
        .bind(&event.content())
        .bind(event.vector_clock().write_to_bytes()?)
        .bind(event.indices().write_to_bytes()?)
        .bind(&signed_event.signature())
        .bind(&serialized)
        .bind(i64::try_from(server_time)?)
        .fetch_one(&mut *transaction)
        .await?;

    Ok(u64::try_from(id)?)
}

pub(crate) async fn insert_event_link(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    link_content_type: u64,
    pointer: &crate::model::pointer::Pointer,
) -> ::anyhow::Result<()> {
    let query_insert_event_link = "
        INSERT INTO event_links
        (
            subject_system_key_type,
            subject_system_key,
            subject_process,
            subject_logical_clock,
            link_content_type,
            event_id
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
        )
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query_insert_event_link)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            &pointer.system(),
        ))?)
        .bind(crate::model::public_key::get_key_bytes(&pointer.system()))
        .bind(&pointer.process().bytes())
        .bind(i64::try_from(*pointer.logical_clock())?)
        .bind(i64::try_from(link_content_type)?)
        .bind(i64::try_from(event_id)?)
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_event_reference_bytes(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    bytes: &::std::vec::Vec<u8>,
    event_id: u64,
) -> ::anyhow::Result<()> {
    let query_insert_event_link = "
        INSERT INTO event_references_bytes
        (
            subject_bytes,
            event_id
        )
        VALUES (
            $1,
            $2
        )
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query_insert_event_link)
        .bind(bytes)
        .bind(i64::try_from(event_id)?)
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_event_index(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    index_type: u64,
    logical_clock: u64,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO event_indices
        (
            index_type,
            logical_clock,
            event_id
        )
        VALUES (
            $1,
            $2,
            $3
        )
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query)
        .bind(i64::try_from(index_type)?)
        .bind(i64::try_from(logical_clock)?)
        .bind(i64::try_from(event_id)?)
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_claim(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    claim_type: &::std::string::String,
) -> ::anyhow::Result<()> {
    let query_insert_claim = "
        INSERT INTO claims
        (
            claim_type,
            event_id
        )
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query_insert_claim)
        .bind(claim_type)
        .bind(i64::try_from(event_id)?)
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

pub(crate) async fn insert_lww_element(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    event_id: u64,
    lww_element: &crate::protocol::LWWElement,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO lww_elements 
        (
            value,
            unix_milliseconds,
            event_id
        )
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING;
    ";

    ::sqlx::query(query)
        .bind(&lww_element.value)
        .bind(i64::try_from(lww_element.unix_milliseconds)?)
        .bind(i64::try_from(event_id)?)
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

pub(crate) async fn find_claims(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    claim: &crate::model::claim::Claim,
    trust_root: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let proto = crate::model::claim::to_proto(claim)
        .write_to_bytes()
        .map_err(|e| ::anyhow::Error::new(e))?;

    let query_select_claims = "
        SELECT
            raw_event
        FROM
            events
        WHERE
            content_type = 12
        AND
            content = $1
        AND (
            system_key_type,
            system_key,
            process,
            logical_clock
        ) IN (
            SELECT
                t1.subject_system_key_type as system_key_type,
                t1.subject_system_key as system_key,
                t1.subject_process as process,
                t1.subject_logical_clock as logical_clock
            FROM
                event_links t1
            JOIN
                events t2
            ON
                t1.event_id = t2.id
            WHERE
                t2.system_key_type = $2
            AND
                t2.system_key = $3
            AND
                t1.link_content_type = 11
        );
    ";

    let query_select_vouches_for_claim = "
        SELECT
            raw_event
        FROM
            events
        WHERE
            id
        IN (
            SELECT
                event_id as id
            FROM
                event_links
            WHERE
                subject_system_key_type = $1
            AND
                subject_system_key = $2
            AND
                subject_process = $3
            AND
                subject_logical_clock = $4
        );
    ";

    let claims =
        ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query_select_claims)
            .bind(&proto)
            .bind(i64::try_from(crate::model::public_key::get_key_type(
                trust_root,
            ))?)
            .bind(crate::model::public_key::get_key_bytes(trust_root))
            .fetch_all(&mut *transaction)
            .await?
            .iter()
            .map(|raw| {
                crate::model::signed_event::from_proto(
                    &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
                )
            })
            .collect::<::anyhow::Result<
                ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
            >>()?;

    let mut all_vouches = vec![];

    for claim_event_raw in claims.iter() {
        let claim_event = crate::model::event::from_proto(
            &crate::protocol::Event::parse_from_bytes(claim_event_raw.event())?,
        )?;

        let mut vouches = ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(
            query_select_vouches_for_claim,
        )
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            claim_event.system(),
        ))?)
        .bind(crate::model::public_key::get_key_bytes(
            claim_event.system(),
        ))
        .bind(claim_event.process().bytes())
        .bind(i64::try_from(*claim_event.logical_clock())?)
        .fetch_all(&mut *transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::signed_event::from_proto(
                &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()?;

        all_vouches.append(&mut vouches);
    }

    Ok([claims, all_vouches].concat())
}

pub(crate) async fn load_system_head(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let query = "
        SELECT DISTINCT ON (
            system_key_type,
            system_key,
            process
        )
        raw_event
        FROM events
        WHERE system_key_type = $1
        AND system_key = $2
        ORDER BY system_key_type, system_key, process, logical_clock DESC;
    ";

    ::sqlx::query_scalar::<_, ::std::vec::Vec<u8>>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .fetch_all(&mut *transaction)
        .await?
        .iter()
        .map(|raw| {
            crate::model::signed_event::from_proto(
                &crate::protocol::SignedEvent::parse_from_bytes(&raw)?,
            )
        })
        .collect::<::anyhow::Result<
            ::std::vec::Vec<crate::model::signed_event::SignedEvent>,
        >>()
}

pub(crate) async fn load_event_ranges(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
    ranges: &crate::protocol::RangesForSystem,
) -> ::anyhow::Result<::std::vec::Vec<crate::model::signed_event::SignedEvent>>
{
    let mut result = vec![];

    for process_ranges in ranges.ranges_for_processes.iter() {
        let process =
            crate::model::process::from_vec(&process_ranges.process.process)?;

        for range in process_ranges.ranges.iter() {
            for logical_clock in range.low..=range.high {
                let potential_event = load_event(
                    &mut *transaction,
                    system,
                    &process,
                    logical_clock,
                )
                .await?;

                if let Some(event) = potential_event {
                    result.push(event);
                }
            }
        }
    }

    Ok(result)
}

pub(crate) async fn known_ranges_for_system(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    system: &crate::model::public_key::PublicKey,
) -> ::anyhow::Result<crate::protocol::RangesForSystem> {
    let query = "
        SELECT
            process,
            MIN(logical_clock) as low,
            MAX(logical_clock) as high
        FROM (
            SELECT
                *, ROW_NUMBER() OVER(ORDER BY process, logical_clock) as rn
            FROM (
                SELECT
                    process, logical_clock
                FROM
                    events
                WHERE
                    system_key_type = $1
                AND
                    system_key = $2
                UNION ALL
                SELECT
                    process, logical_clock
                FROM
                    deletions
                WHERE
                    system_key_type = $1
                AND
                    system_key = $2
            ) t2
        ) t1
        GROUP BY process, logical_clock - rn;
    ";

    let ranges = ::sqlx::query_as::<_, RangeRow>(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .fetch_all(&mut *transaction)
        .await
        .map_err(|err| ::anyhow::Error::new(err))?;

    let mut result = crate::protocol::RangesForSystem::new();

    for range in ranges.iter() {
        let process =
            ::protobuf::MessageField::some(crate::model::process::to_proto(
                &crate::model::process::from_vec(&range.process)?,
            ));

        let mut found: Option<&mut crate::protocol::RangesForProcess> = None;

        for ranges_for_process in result.ranges_for_processes.iter_mut() {
            if ranges_for_process.process == process {
                found = Some(ranges_for_process);

                break;
            }
        }

        let ranges_for_process = match found {
            Some(x) => x,
            None => {
                let mut next = crate::protocol::RangesForProcess::new();
                next.process = process;
                result.ranges_for_processes.push(next);
                result.ranges_for_processes.last_mut().unwrap()
            }
        };

        let mut range_proto = crate::protocol::Range::new();
        range_proto.low = range.low;
        range_proto.high = range.high;
        ranges_for_process.ranges.push(range_proto);
    }

    Ok(result)
}

pub(crate) async fn censor_event(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    censor_type: CensorshipType,
    system: &crate::model::public_key::PublicKey,
    process: &crate::model::process::Process,
    logical_clock: u64,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO censored_events (
            system_key_type,
            system_key,
            process,
            logical_clock,
            censorship_type
        )
        VALUES ($1, $2, $3, $4, $5);
        ";
    ::sqlx::query(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(system))
        .bind(process.bytes())
        .bind(i64::try_from(logical_clock)?)
        .bind(censor_type)
        .execute(&mut *transaction)
        .await?;

    Ok(())
}
pub(crate) async fn censor_system(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    censor_type: CensorshipType,
    system: crate::model::public_key::PublicKey,
) -> ::anyhow::Result<()> {
    let query = "
        INSERT INTO censored_systems (
            system_key_type,
            system_key,
            censorship_type
        )
        VALUES ($1, $2, $3);
        ";
    ::sqlx::query(query)
        .bind(i64::try_from(crate::model::public_key::get_key_type(
            &system,
        ))?)
        .bind(crate::model::public_key::get_key_bytes(&system))
        .bind(censor_type)
        .execute(&mut *transaction)
        .await?;

    Ok(())
}

pub(crate) async fn load_random_profiles(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
) -> ::anyhow::Result<Vec<crate::model::public_key::PublicKey>> {
    let query = "
    SELECT 
      system_key_type, 
      system_key 
    FROM 
      (
        SELECT 
          DISTINCT events.system_key_type, 
          events.system_key 
        FROM 
          events 
          LEFT JOIN censored_systems ON events.system_key_type = censored_systems.system_key_type 
          AND events.system_key = censored_systems.system_key 
        WHERE 
          censored_systems.system_key IS NULL
      ) AS systems 
    ORDER BY 
      RANDOM() 
    LIMIT 
      10;
    ";

    let sys_rows = ::sqlx::query_as::<_, SystemRow>(query)
        .fetch_all(&mut *transaction)
        .await?;

    let mut result_set = vec![];
    for sys_row in sys_rows.iter() {
        let sys = crate::model::public_key::from_type_and_bytes(
            sys_row.system_key_type,
            &sys_row.system_key,
        )?;
        result_set.push(sys);
    }

    return Ok(result_set);
}

#[cfg(test)]
pub mod tests {
    use ::protobuf::Message;

    #[::sqlx::test]
    async fn test_prepare_database(pool: ::sqlx::PgPool) -> ::sqlx::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    #[::sqlx::test]
    async fn test_persist_event(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let keypair = crate::model::tests::make_test_keypair();
        let process = crate::model::tests::make_test_process();

        let signed_event =
            crate::model::tests::make_test_event(&keypair, &process, 52);

        crate::ingest::ingest_event_postgres(&mut transaction, &signed_event)
            .await?;

        let system = crate::model::public_key::PublicKey::Ed25519(
            keypair.public.clone(),
        );

        let loaded_event = crate::postgres::load_event(
            &mut transaction,
            &system,
            &process,
            52,
        )
        .await?;

        transaction.commit().await?;

        assert!(Some(signed_event) == loaded_event);

        Ok(())
    }

    #[::sqlx::test]
    async fn test_head(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = crate::model::tests::make_test_keypair();
        let s2 = crate::model::tests::make_test_keypair();

        let s1p1 = crate::model::tests::make_test_process();
        let s1p2 = crate::model::tests::make_test_process();
        let s2p1 = crate::model::tests::make_test_process();

        let s1p1e1 = crate::model::tests::make_test_event(&s1, &s1p1, 1);
        let s1p1e2 = crate::model::tests::make_test_event(&s1, &s1p1, 2);
        let s1p2e1 = crate::model::tests::make_test_event(&s1, &s1p2, 1);
        let s2p1e5 = crate::model::tests::make_test_event(&s2, &s2p1, 5);

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e5).await?;

        let system =
            crate::model::public_key::PublicKey::Ed25519(s1.public.clone());

        let head = crate::postgres::load_system_head(&mut transaction, &system)
            .await?;

        transaction.commit().await?;

        let expected = vec![s1p1e2, s1p2e1];

        assert!(expected.len() == head.len());

        for expected_item in expected.iter() {
            let mut found = false;

            for got_item in head.iter() {
                if got_item == expected_item {
                    found = true;
                    break;
                }
            }

            assert!(found);
        }

        Ok(())
    }

    #[::sqlx::test]
    async fn test_known_ranges(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        crate::postgres::prepare_database(&mut transaction).await?;

        let s1 = crate::model::tests::make_test_keypair();
        let s2 = crate::model::tests::make_test_keypair();

        let s1p1 = crate::model::tests::make_test_process();
        let s1p2 = crate::model::tests::make_test_process();
        let s2p1 = crate::model::tests::make_test_process();

        let s1p1e1 = crate::model::tests::make_test_event(&s1, &s1p1, 1);
        let s1p1e2 = crate::model::tests::make_test_event(&s1, &s1p1, 2);
        let s1p1e6 = crate::model::tests::make_test_event(&s1, &s1p1, 6);
        let s1p2e1 = crate::model::tests::make_test_event(&s1, &s1p2, 1);
        let s2p1e5 = crate::model::tests::make_test_event(&s2, &s2p1, 5);

        let mut delete = crate::protocol::Delete::new();
        delete.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(&s1p1),
        );
        delete.logical_clock = 2;
        delete.indices =
            ::protobuf::MessageField::some(crate::protocol::Indices::new());

        let s1p1e3 = crate::model::tests::make_test_event_with_content(
            &s1,
            &s1p1,
            3,
            0,
            &delete.write_to_bytes()?,
            vec![],
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e2).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e3).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e6).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s1p2e1).await?;
        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e5).await?;

        let system =
            crate::model::public_key::PublicKey::Ed25519(s1.public.clone());

        let ranges =
            crate::postgres::known_ranges_for_system(&mut transaction, &system)
                .await?;

        transaction.commit().await?;

        let mut expected = crate::protocol::RangesForSystem::new();

        let mut expected_p1 = crate::protocol::RangesForProcess::new();
        expected_p1.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(&s1p1),
        );

        let mut expected_p1r1 = crate::protocol::Range::new();
        expected_p1r1.low = 1;
        expected_p1r1.high = 3;

        let mut expected_p1r2 = crate::protocol::Range::new();
        expected_p1r2.low = 6;
        expected_p1r2.high = 6;

        expected_p1.ranges.push(expected_p1r1);
        expected_p1.ranges.push(expected_p1r2);

        let mut expected_p2 = crate::protocol::RangesForProcess::new();
        expected_p2.process = ::protobuf::MessageField::some(
            crate::model::process::to_proto(&s1p2),
        );

        let mut expected_p2r1 = crate::protocol::Range::new();
        expected_p2r1.low = 1;
        expected_p2r1.high = 1;

        expected_p2.ranges.push(expected_p2r1);

        expected.ranges_for_processes.push(expected_p1);
        expected.ranges_for_processes.push(expected_p2);

        assert!(
            expected.ranges_for_processes.len()
                == ranges.ranges_for_processes.len()
        );

        for expected_item in expected.ranges_for_processes.iter() {
            let mut found = false;

            for got_item in ranges.ranges_for_processes.iter() {
                if got_item == expected_item {
                    found = true;
                    break;
                }
            }

            assert!(found);
        }

        Ok(())
    }

    #[::sqlx::test]
    async fn test_find_claims(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        crate::postgres::prepare_database(&mut transaction).await?;

        let mut claim_hacker_news = crate::protocol::ClaimIdentifier::new();
        claim_hacker_news.identifier = "hello".to_string();
        let claim_hacker_news_bytes = claim_hacker_news.write_to_bytes()?;
        let claim = crate::model::claim::Claim::new(
            &"HackerNews".to_string(),
            &claim_hacker_news_bytes,
        );

        let s1 = crate::model::tests::make_test_keypair();
        let s1p1 = crate::model::tests::make_test_process();

        let s1p1e1 = crate::model::tests::make_test_event_with_content(
            &s1,
            &s1p1,
            1,
            12,
            &crate::model::claim::to_proto(&claim).write_to_bytes()?,
            vec![],
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;

        let s2 = crate::model::tests::make_test_keypair();
        let s2p1 = crate::model::tests::make_test_process();

        let vouch = crate::protocol::Vouch::new();

        let s2p1e1 = crate::model::tests::make_test_event_with_content(
            &s2,
            &s2p1,
            1,
            11,
            &vec![],
            vec![crate::model::reference::Reference::Pointer(
                crate::model::pointer::Pointer::new(
                    crate::model::public_key::PublicKey::Ed25519(
                        s1.public.clone(),
                    ),
                    s1p1,
                    1,
                    crate::model::digest::Digest::SHA256(
                        crate::model::hash_event(s1p1e1.event()),
                    ),
                ),
            )],
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e1).await?;

        let result = crate::postgres::find_claims(
            &mut transaction,
            &claim,
            &crate::model::public_key::PublicKey::Ed25519(s2.public.clone()),
        )
        .await?;

        let expected = vec![s1p1e1, s2p1e1];

        transaction.commit().await?;

        assert!(result == expected);

        Ok(())
    }
}
