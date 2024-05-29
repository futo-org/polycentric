SELECT
    process,
    MIN(logical_clock) AS low,
    MAX(logical_clock) AS high
FROM (
    SELECT
        *,
        ROW_NUMBER() OVER (ORDER BY process, logical_clock) AS rn
    FROM (
        SELECT
            process,
            logical_clock
        FROM
            events
        WHERE
            system_key_type = $1
            AND
            system_key = $2
        UNION ALL
        SELECT
            process,
            logical_clock
        FROM
            deletions
        WHERE
            system_key_type = $1
            AND
            system_key = $2
    ) t2
) t1
GROUP BY process, logical_clock - rn
ORDER BY process, low;
