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
    server_time,
    unix_milliseconds
)
SELECT * FROM
    UNNEST(
        $1::bigint [],
        $2::bytea [],
        $3::bytea [],
        $4::bigint [],
        $5::bigint [],
        $6::bytea [],
        $7::bytea [],
        $8::bytea [],
        $9::bytea [],
        $10::bytea [],
        $11::bigint [],
        $12::bigint []
    ) AS p (
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
        server_time,
        unix_milliseconds
    )
WHERE (
    system_key_type,
    system_key,
    process,
    logical_clock
) NOT IN (
    SELECT
        system_key_type,
        system_key,
        process,
        logical_clock
    FROM
        deletions
    WHERE
        deletions.system_key_type = system_key_type
        AND
        deletions.system_key = system_key
        AND
        deletions.process = process
        AND
        deletions.logical_clock = logical_clock
)
ORDER BY
    system_key_type,
    system_key,
    process,
    logical_clock
ON CONFLICT DO NOTHING
RETURNING
id,
system_key_type,
system_key,
process,
logical_clock;
