WITH input_rows (
    system_key_type,
    system_key,
    content_type
) AS (
    SELECT
        system_key_type,
        system_key,
        process,
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

SELECT DISTINCT ON (
    events.system_key_type,
    events.system_key,
    events.content_type
) raw_event FROM events INNER JOIN input_rows ON
    events.system_key_type = input_rows.system_key_type
AND
    events.system_key = input_rows.system_key
AND
    events.content_type = input_rows.content_type
INNER JOIN lww_elements
ON
    events.id = lww_elements.event_id 
ORDER BY
    lww_elements.unix_milliseconds DESC,
    events.process DESC

