WITH input_rows (
    system_key_type,
    system_key,
    content_type
) AS (
    SELECT
        system_key_type,
        system_key,
        process,
        low,
        high
    ) * FROM
        UNNEST(
            $1::bigint [],
            $3::bytea [],
            $5::bigint []
        ) AS p (
            system_key_type,
            system_key,
            content_type
        )
)

SELECT raw_event FROM events INNER JOIN input_rows ON
    events.system_key_type = input_rows.system_key_type
AND
    events.system_key = input_rows.system_key
AND
    events.process = input_rows.process
AND
    events.logical_clock = input_rows.logical_clock



