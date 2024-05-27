DELETE FROM events
WHERE (
    system_key_type,
    system_key,
    process,
    logical_clock
) IN (
    SELECT * FROM UNNEST(
        $1::bigint [],
        $2::bytea [],
        $3::bytea [],
        $4::bigint []
    ) AS p (
        system_key_type,
        system_key,
        process,
        logical_clock
    )
)
RETURNING raw_event;
