CREATE TABLE IF NOT EXISTS schema_version (
    version INT8 NOT NULL,
    upgraded_on TIMESTAMPTZ NOT NULL
);

INSERT INTO schema_version (version, upgraded_on)
SELECT
    0,
    NOW()
WHERE NOT EXISTS (SELECT * FROM schema_version);

DO $$ BEGIN
    CREATE TYPE censorship_type AS ENUM (
        'do_not_recommend',
        'refuse_storage'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE link_type AS ENUM (
        'react',
        'boost'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    system_key_type INT8 NOT NULL,
    system_key BYTEA NOT NULL,
    process BYTEA NOT NULL,
    logical_clock INT8 NOT NULL,
    content_type INT8 NOT NULL,
    content BYTEA NOT NULL,
    vector_clock BYTEA NOT NULL,
    indices BYTEA NOT NULL,
    signature BYTEA NOT NULL,
    raw_event BYTEA NOT NULL,
    server_time INT8 NOT NULL,
    unix_milliseconds INT8

    CHECK (system_key_type >= 0),
    CHECK (LENGTH(process) = 16),
    CHECK (logical_clock >= 0),
    CHECK (content_type >= 0),

    UNIQUE (system_key_type, system_key, process, logical_clock)
);

CREATE INDEX IF NOT EXISTS
events_content_type_idx
ON
events (content_type);

CREATE TABLE IF NOT EXISTS count_references_bytes (
    id BIGSERIAL PRIMARY KEY,
    subject_bytes BYTEA NOT NULL,
    count INT8 NOT NULL,
    from_type INT8 NOT NULL,

    CHECK (count >= 0),
    CHECK (from_type >= 0),

    UNIQUE (subject_bytes, from_type)
);

CREATE TABLE IF NOT EXISTS count_lww_element_references_bytes (
    id BIGSERIAL PRIMARY KEY,
    subject_bytes BYTEA NOT NULL,
    count INT8 NOT NULL,
    from_type INT8 NOT NULL,
    value BYTEA NOT NULL,

    CHECK (count >= 0),
    CHECK (from_type >= 0),

    UNIQUE (subject_bytes, value, from_type)
);

CREATE TABLE IF NOT EXISTS count_references_pointer (
    id BIGSERIAL PRIMARY KEY,
    subject_system_key_type INT8 NOT NULL,
    subject_system_key BYTEA NOT NULL,
    subject_process BYTEA NOT NULL,
    subject_logical_clock INT8 NOT NULL,
    count INT8 NOT NULL,
    from_type INT8 NOT NULL,


    CHECK (subject_system_key_type >= 0),
    CHECK (LENGTH(subject_process) = 16),
    CHECK (subject_logical_clock >= 0),
    CHECK (count >= 0),
    CHECK (from_type >= 0),

    UNIQUE (
        subject_system_key_type,
        subject_system_key,
        subject_process,
        subject_logical_clock,
        from_type
    )
);

CREATE TABLE IF NOT EXISTS count_lww_element_references_pointer (
    id BIGSERIAL PRIMARY KEY,
    subject_system_key_type INT8 NOT NULL,
    subject_system_key BYTEA NOT NULL,
    subject_process BYTEA NOT NULL,
    subject_logical_clock INT8 NOT NULL,
    count INT8 NOT NULL,
    from_type INT8 NOT NULL,
    value BYTEA NOT NULL,


    CHECK (subject_system_key_type >= 0),
    CHECK (LENGTH(subject_process) = 16),
    CHECK (subject_logical_clock >= 0),
    CHECK (count >= 0),
    CHECK (from_type >= 0),

    UNIQUE (
        subject_system_key_type,
        subject_system_key,
        subject_process,
        subject_logical_clock,
        value,
        from_type
    )
);

CREATE TABLE IF NOT EXISTS event_links (
    id BIGSERIAL PRIMARY KEY,
    subject_system_key_type INT8 NOT NULL,
    subject_system_key BYTEA NOT NULL,
    subject_process BYTEA NOT NULL,
    subject_logical_clock INT8 NOT NULL,
    link_content_type INT8 NOT NULL,
    event_id BIGSERIAL NOT NULL,

    CHECK (subject_system_key_type >= 0),
    CHECK (LENGTH(subject_process) = 16),
    CHECK (subject_logical_clock >= 0),
    CHECK (link_content_type >= 0),

    CONSTRAINT fk_event
    FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
event_links_subject_idx
ON
event_links (
    subject_system_key_type,
    subject_system_key,
    subject_process,
    subject_logical_clock
);

CREATE TABLE IF NOT EXISTS event_references_bytes (
    id BIGSERIAL PRIMARY KEY,
    subject_bytes BYTEA NOT NULL,
    event_id BIGSERIAL NOT NULL,

    CONSTRAINT fk_event
    FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
event_references_bytes_subject_bytes_idx
ON
event_references_bytes (subject_bytes);


CREATE TABLE IF NOT EXISTS event_indices (
    id BIGSERIAL PRIMARY KEY,
    index_type INT8 NOT NULL,
    logical_clock INT8 NOT NULL,
    event_id BIGSERIAL NOT NULL,

    CHECK (index_type >= 0),
    CHECK (logical_clock >= 0),

    CONSTRAINT fk_event
    FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS claims (
    id BIGSERIAL PRIMARY KEY,
    claim_type INT8 NOT NULL,
    event_id BIGSERIAL NOT NULL,
    fields JSONB NOT NULL,

    CHECK (claim_type >= 0),

    CONSTRAINT fk_event
    FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lww_elements (
    id BIGSERIAL PRIMARY KEY,
    unix_milliseconds INT8 NOT NULL,
    value BYTEA NOT NULL,
    event_id BIGSERIAL NOT NULL,

    CHECK (unix_milliseconds >= 0),

    CONSTRAINT fk_event
    FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS process_state (
    id BIGSERIAL PRIMARY KEY,
    system_key_type INT8 NOT NULL,
    system_key BYTEA NOT NULL,
    process BYTEA NOT NULL,
    logical_clock INT8 NOT NULL,

    CHECK (system_key_type >= 0),
    CHECK (LENGTH(process) = 16),
    CHECK (logical_clock >= 0),

    UNIQUE (system_key_type, system_key, process)
);

CREATE TABLE IF NOT EXISTS deletions (
    id BIGSERIAL PRIMARY KEY,
    system_key_type INT8 NOT NULL,
    system_key BYTEA NOT NULL,
    process BYTEA NOT NULL,
    logical_clock INT8 NOT NULL,
    event_id BIGSERIAL NOT NULL,
    unix_milliseconds INT8,
    content_type INT8 NOT NULL,

    CHECK (system_key_type >= 0),
    CHECK (LENGTH(process) = 16),
    CHECK (logical_clock >= 0),

    CONSTRAINT fk_event
    FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS censored_events (
    id BIGSERIAL PRIMARY KEY,
    system_key_type INT8 NOT NULL,
    system_key BYTEA NOT NULL,
    process BYTEA NOT NULL,
    logical_clock INT8 NOT NULL,
    censorship_type CENSORSHIP_TYPE NOT NULL,

    CHECK (system_key_type >= 0),
    CHECK (LENGTH(process) = 16),
    CHECK (logical_clock >= 0),

    UNIQUE (system_key_type, system_key, process, logical_clock)
);

CREATE TABLE IF NOT EXISTS censored_systems (
    id BIGSERIAL PRIMARY KEY,
    system_key_type INT8 NOT NULL,
    system_key BYTEA NOT NULL,
    censorship_type CENSORSHIP_TYPE NOT NULL,

    CHECK (system_key_type >= 0),

    UNIQUE (system_key_type, system_key)
);

CREATE TABLE IF NOT EXISTS lww_element_latest_reference_pointer (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGSERIAL NOT NULL,
    system_key_type INT8 NOT NULL,
    system_key BYTEA NOT NULL,
    process BYTEA NOT NULL,
    content_type INT8 NOT NULL,
    lww_element_unix_milliseconds INT8 NOT NULL,
    subject_system_key_type INT8 NOT NULL,
    subject_system_key BYTEA NOT NULL,
    subject_process BYTEA NOT NULL,
    subject_logical_clock INT8 NOT NULL,

    CONSTRAINT fk_event
    FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE CASCADE,

    UNIQUE (
        system_key_type,
        system_key,
        content_type,
        subject_system_key_type,
        subject_system_key,
        subject_process,
        subject_logical_clock
    )
);

CREATE INDEX IF NOT EXISTS
lww_element_latest_reference_pointer_idx
ON
lww_element_latest_reference_pointer (
    system_key_type,
    system_key,
    content_type,
    subject_system_key_type,
    subject_system_key,
    subject_process,
    subject_logical_clock,
    lww_element_unix_milliseconds,
    process
);

CREATE TABLE IF NOT EXISTS lww_element_latest_reference_bytes (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGSERIAL NOT NULL,
    system_key_type INT8 NOT NULL,
    system_key BYTEA NOT NULL,
    process BYTEA NOT NULL,
    content_type INT8 NOT NULL,
    lww_element_unix_milliseconds INT8 NOT NULL,
    subject BYTEA NOT NULL,

    CONSTRAINT fk_event
    FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE CASCADE,

    UNIQUE (
        system_key_type,
        system_key,
        content_type,
        subject
    )
);

CREATE INDEX IF NOT EXISTS
lww_element_latest_reference_bytes_idx
ON
lww_element_latest_reference_bytes (
    system_key_type,
    system_key,
    content_type,
    subject,
    lww_element_unix_milliseconds,
    process
);

CREATE TABLE IF NOT EXISTS identity_handles (
    handle VARCHAR(64) PRIMARY KEY,
    system_key_type INT8 NOT NULL,
    system_key BYTEA NOT NULL,

    UNIQUE (
        system_key_type,
        system_key
    )
);
