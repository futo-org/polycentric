INSERT INTO events (
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
SELECT *
FROM
    UNNEST($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) AS p (
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
WHERE
    (system_key_type, system_key, process, logical_clock)
    NOT IN (
        SELECT
            system_key_type,
            system_key,
            process,
            logical_clock
        FROM deletions
        WHERE
            deletions.system_key_type = system_key_type
            AND deletions.system_key = system_key
            AND deletions.process = process
            AND deletions.logical_clock = logical_clock
    )
ORDER BY
    system_key_type,
    system_key,
    process,
    logical_clock
ON CONFLICT
DO NOTHING
RETURNING id,
system_key_type,
system_key,
process,
logical_clock;
