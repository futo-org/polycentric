-- Consolidated Schema from Migrations up to 2025-05-15

-- From: 20250428191213_initial_schema.sql
-- Enable built-in uuid_v4 (uuid-ossp) for compatibility and pgcrypto for random bytes
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------
-- UUID v7 generator (timestamp-ordered UUIDs)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.uuid_generate_v7() RETURNS uuid AS $$
DECLARE
    ts            BIGINT;  -- milliseconds since Unix epoch
    uuid_bytes    BYTEA;   -- final 16-byte buffer
    ts_bytes      BYTEA;   -- first 6 bytes = timestamp (48 bits)
    rnd_bytes     BYTEA;   -- remaining 10 random bytes
BEGIN
    ts := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
    ts_bytes  := decode(lpad(to_hex(ts), 12, '0'), 'hex');
    rnd_bytes := gen_random_bytes(10);
    uuid_bytes := ts_bytes || rnd_bytes;

    -- version 7
    uuid_bytes := set_byte(uuid_bytes, 6,
                  (get_byte(uuid_bytes, 6) & 15) | 112);
    -- RFC-4122 variant
    uuid_bytes := set_byte(uuid_bytes, 8,
                  (get_byte(uuid_bytes, 8) & 63) | 128);

    RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Categories Table
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Boards Table
CREATE TABLE boards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_boards_category_id ON boards(category_id);

-- Threads Table
CREATE TABLE threads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    -- Using TEXT for PolycentricId for flexibility, adjust if format is known
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_threads_board_id ON threads(board_id);

-- Posts Table
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    -- Using TEXT for PolycentricId for flexibility
    author_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quote_of UUID REFERENCES posts(id) ON DELETE SET NULL -- Nullable foreign key to self for quotes
);
CREATE INDEX idx_posts_thread_id ON posts(thread_id);
CREATE INDEX idx_posts_quote_of ON posts(quote_of);

-- From: 20250428203755_create_post_images_table.sql
CREATE TABLE post_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    -- Optional fields:
    -- alt_text VARCHAR(255),
    -- display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_post_images_post_id ON post_images(post_id);

-- From: 20250430173825_add_unique_constraint_to_category_name.sql
-- Add unique constraint on (category_id, name) to boards table
ALTER TABLE boards
ADD CONSTRAINT boards_category_id_name_unique UNIQUE (category_id, name);

-- From: 20250501160651_add_order_column.sql
-- Add order column to categories
ALTER TABLE categories
ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Add order column to boards
ALTER TABLE boards
ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Optional: Create indexes for ordering
CREATE INDEX idx_categories_order ON categories ("order");
CREATE INDEX idx_boards_order ON boards ("order");

-- Optional but Recommended: Update existing rows to have a default order
-- This sets order based on creation time initially. Adjust if needed.
-- Note: This data update part might fail or behave unexpectedly if run on an empty database.
-- Consider removing or making it conditional if this consolidated script targets initial setup.
WITH ordered_categories AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
    FROM categories
)
UPDATE categories
SET "order" = ordered_categories.rn - 1
FROM ordered_categories
WHERE categories.id = ordered_categories.id;

-- Do the same for boards within each category
WITH ordered_boards AS (
    SELECT id, category_id, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY created_at ASC) as rn
    FROM boards
)
UPDATE boards
SET "order" = ordered_boards.rn - 1
FROM ordered_boards
WHERE boards.id = ordered_boards.id;

-- From: 20250501172215_add_polycentric_pointer_to_posts.sql
-- Add columns to store the Polycentric event pointer associated with a forum post
ALTER TABLE posts
ADD COLUMN polycentric_system_id BYTEA NULL,
ADD COLUMN polycentric_process_id BYTEA NULL,
-- Use BIGINT for u64 sequence numbers
ADD COLUMN polycentric_log_seq BIGINT NULL;

-- From: 20250515000000_change_author_id_to_bytea.sql
-- Change author_id in posts and created_by in threads to BYTEA to store Polycentric PublicKeys
ALTER TABLE posts
ALTER COLUMN author_id TYPE BYTEA
USING author_id::bytea; -- Attempt to cast existing TEXT data if needed, might fail if not valid hex/base64 etc.

ALTER TABLE threads
ALTER COLUMN created_by TYPE BYTEA
USING created_by::bytea; -- Attempt to cast existing TEXT data if needed

-- This constraint seems duplicated from 20250430173825, commenting out
-- ALTER TABLE categories
-- ADD CONSTRAINT categories_name_unique UNIQUE (name);

-- Additional unique constraint from 20250515000000 file (was potentially misplaced there)
-- Ensure category names themselves are unique
ALTER TABLE categories
ADD CONSTRAINT categories_name_unique UNIQUE (name); 