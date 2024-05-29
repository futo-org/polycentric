WITH input_rows (
    event_id,
    system_key_type,
    system_key,
    process,
    content_type,
    lww_element_unix_milliseconds,
    subject
) AS (
    SELECT DISTINCT ON (
        system_key_type,
        system_key,
        content_type,
        subject
    ) * FROM
        UNNEST(
            $1::bigint [],
            $2::bigint [],
            $3::bytea [],
            $4::bytea [],
            $5::bigint [],
            $6::bigint [],
            $7::bytea []
        ) AS p (
            event_id,
            system_key_type,
            system_key,
            process,
            content_type,
            lww_element_unix_milliseconds,
            subject
        )
    ORDER BY
        system_key_type,
        system_key,
        content_type,
        subject,
        lww_element_unix_milliseconds DESC,
        process
),

mutations AS (
    SELECT
        events.raw_event AS original_event,
        input_rows.*
    FROM
        events
    INNER JOIN
        lww_element_latest_reference_bytes
        ON
            events.id = lww_element_latest_reference_bytes.event_id
    INNER JOIN
        input_rows
        ON
            lww_element_latest_reference_bytes.system_key_type
            = input_rows.system_key_type
            AND
            lww_element_latest_reference_bytes.system_key
            = input_rows.system_key
            AND
            lww_element_latest_reference_bytes.content_type
            = input_rows.content_type
            AND
            lww_element_latest_reference_bytes.subject = input_rows.subject
    WHERE
        (
            input_rows.lww_element_unix_milliseconds,
            input_rows.process
        )
        >
        (
            lww_element_latest_reference_bytes.lww_element_unix_milliseconds,
            lww_element_latest_reference_bytes.process
        )
    FOR UPDATE
),

new_rows AS (
    INSERT INTO lww_element_latest_reference_bytes (
        event_id,
        system_key_type,
        system_key,
        process,
        content_type,
        lww_element_unix_milliseconds,
        subject
    )
    SELECT
        event_id,
        system_key_type,
        system_key,
        process,
        content_type,
        lww_element_unix_milliseconds,
        subject
    FROM mutations
    ON CONFLICT (
        system_key_type,
        system_key,
        content_type,
        subject
    )
    DO UPDATE
    SET
    event_id = excluded.event_id,
    process = excluded.process,
    lww_element_unix_milliseconds = excluded.lww_element_unix_milliseconds
)

SELECT
    system_key_type,
    system_key,
    process,
    logical_clock,
    original_event
FROM mutations;
