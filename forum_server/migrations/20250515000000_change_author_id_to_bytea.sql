-- Change author_id in posts and created_by in threads to BYTEA to store Polycentric PublicKeys

ALTER TABLE posts
ALTER COLUMN author_id TYPE BYTEA
USING author_id::bytea; -- Attempt to cast existing TEXT data if needed, might fail if not valid hex/base64 etc.

ALTER TABLE threads
ALTER COLUMN created_by TYPE BYTEA
USING created_by::bytea; -- Attempt to cast existing TEXT data if needed 