INSERT INTO event_references_bytes
(
    subject_bytes,
    event_id
)
SELECT * FROM UNNEST(
    $1::bytea [],
    $2::bigint []
) AS p (
    subject_bytes,
    event_id
)
