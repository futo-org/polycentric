INSERT INTO deletions
(
    system_key_type,
    system_key,
    process,
    logical_clock,
    event_id,
    unix_milliseconds,
    content_type
)
SELECT * FROM UNNEST(
    $1::bigint [],
    $2::bytea [],
    $3::bytea [],
    $4::bigint [],
    $5::bigint [],
    $6::bigint [],
    $7::bigint []
);
