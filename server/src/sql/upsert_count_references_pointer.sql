INSERT INTO count_references_pointer (
    subject_system_key_type,
    subject_system_key,
    subject_process,
    subject_logical_clock,
    from_type,
    count
)
SELECT * FROM
    UNNEST(
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
        from_type,
        count
    )
ORDER BY
    subject_system_key_type,
    subject_system_key,
    subject_process,
    subject_logical_clock,
    from_type
ON CONFLICT (
    subject_system_key_type,
    subject_system_key,
    subject_process,
    subject_logical_clock,
    from_type
)
DO UPDATE
SET
count = count_references_pointer.count + excluded.count
