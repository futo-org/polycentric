INSERT INTO count_references_bytes (
    subject_bytes,
    from_type,
    count
)
SELECT * FROM
    UNNEST(
        $1::bytea [],
        $2::bigint [],
        $3::bigint []
    ) AS p (
        subject_bytes,
        from_type,
        count
    )
ORDER BY
    subject_bytes,
    from_type
ON CONFLICT (
    subject_bytes,
    from_type
)
DO UPDATE
SET
count = count_references_bytes.count + excluded.count
