SELECT DISTINCT ON (
    system_key_type,
    system_key,
    process,
    logical_clock
) raw_event FROM
    (
        SELECT DISTINCT ON (
            system_key_type,
            system_key,
            process
        )
            raw_event,
            system_key_type,
            process,
            logical_clock
        FROM events
        WHERE
            system_key_type = $1
            AND system_key = $2
        ORDER BY
            system_key_type DESC,
            system_key DESC,
            process DESC,
            logical_clock DESC
    )
UNION
(
    SELECT DISTINCT ON (
        system_key_type,
        system_key,
        process
    )
        raw_event,
        system_key_type,
        process,
        logical_clock
    FROM events
    WHERE
        system_key_type = $1
        AND system_key = $2
        AND content_type = 2
    ORDER BY
        system_key_type DESC, system_key DESC, process DESC, logical_clock DESC

)
