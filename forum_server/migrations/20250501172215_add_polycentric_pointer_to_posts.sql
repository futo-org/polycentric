    -- Add columns to store the Polycentric event pointer associated with a forum post
    ALTER TABLE posts
    ADD COLUMN polycentric_system_id BYTEA NULL,
    ADD COLUMN polycentric_process_id BYTEA NULL,
    -- Use BIGINT for u64 sequence numbers
    ADD COLUMN polycentric_log_seq BIGINT NULL; 