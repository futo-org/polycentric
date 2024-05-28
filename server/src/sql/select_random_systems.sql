SELECT
    system_key_type,
    system_key
FROM
    (
        SELECT DISTINCT
            events.system_key_type,
            events.system_key
        FROM
            events
        LEFT JOIN censored_systems
            ON
                events.system_key_type = censored_systems.system_key_type
                AND events.system_key = censored_systems.system_key
        WHERE
            censored_systems.system_key IS NULL
    ) AS systems
ORDER BY
    RANDOM()
LIMIT
    10;
