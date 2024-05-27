INSERT INTO event_links
(
    subject_system_key_type,
    subject_system_key,
    subject_process,
    subject_logical_clock,
    link_content_type,
    event_id
)
SELECT * FROM UNNEST(
    $1::bigint [],
    $2::bytea [],
    $3::bytea [],
    $4::bigint [],
    $5::bigint [],
    $6::bigint []
) AS p (
    subject_system_key_type,
    subject_system_key,
    subject_process,
    subject_logical_clock,
    link_content_type,
    event_id
)
