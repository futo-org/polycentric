INSERT INTO claims
(
    claim_type,
    event_id,
    fields
)
SELECT * FROM UNNEST(
    $1::bigint [],
    $2::bigint [],
    $3::json []
);
