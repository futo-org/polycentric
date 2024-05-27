SELECT
    pg_advisory_xact_lock(
        ('x' || md5(p.system_key))::bit(64)::bigint
    )
FROM (
    SELECT DISTINCT system_key
    FROM
        unnest(
            $1::bytea []
        ) AS p (
            system_key
        )
    ORDER BY system_key
) AS p
