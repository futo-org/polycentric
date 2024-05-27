INSERT INTO lww_elements
(
    value,
    unix_milliseconds,
    event_id
)
SELECT * FROM UNNEST(
    $1::bytea [],
    $2::bigint [],
    $3::bigint []
);
