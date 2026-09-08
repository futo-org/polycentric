# Command to run in `dev` target, e.g. `make RUN=check dev`.
RUN?=run
# Location of the .env file containing various required variables.
ENV_FILE=$(dir $(firstword $(MAKEFILE_LIST))).env

# Development loop, runs make $RUN whenever a source file changes.
# Usage:
# $ make dev           # To run `cargo run`.
# $ make dev RUN=check # To run `cargo check`.
dev:
	find src/ entity/ Makefile Cargo.toml | entr -d -cc -r $(MAKE) $(RUN)

# Start the dependencies, but not the server itself.
start_dependencies:
	cd ../../ && docker compose up -d postgres kafka

# Run the backend.
run:
	cargo run --bin server

# Run all tests.
test:
	cargo test
	cd tests && cargo test

# Check if the build is ok.
check:
	cargo check

# Linting.
lint: clippy
clippy:
	cargo clippy --all-targets --all-features -- -D warnings \
		--allow clippy::double_must_use

# Format.
fmt:
	cargo fmt

# Create documentation.
doc:
	cargo doc

# Run the database migration.
db_migrations:
	cd migrations && cargo run

# Run psql connected to the database.
psql:
	source $(ENV_FILE) && \
	PGPASSWORD="$$DB_PASSWORD" psql \
		--dbname "$$DB_NAME" --host "$$DB_HOST" --port "$$DB_PORT" --username "$$DB_USER"

# Write the database schema to `db_schema.sql`.
db_schema.sql: db_schema
db_schema:
	source $(ENV_FILE) && \
	PGPASSWORD="$$DB_PASSWORD" pg_dump \
		--dbname "$$DB_NAME" --host "$$DB_HOST" --port "$$DB_PORT" --username "$$DB_USER" \
		--exclude-schema=seaql_migrations --schema-only --no-owner \
		> db_schema.sql

# Write a backup of the database to `db_dump.sql`.
db_dump.sql: db_dump
db_dump:
	source $(ENV_FILE) && \
	PGPASSWORD="$$DB_PASSWORD" pg_dump \
		--dbname "$$DB_NAME" --host "$$DB_HOST" --port "$$DB_PORT" --username "$$DB_USER" \
		> db_dump.sql

# Clean build artifects.
clean:
	cargo clean

# Command to run before commiting.
pre_commit: lint fmt test db_schema

.PHONY: check clean clippy db_dump db_migrations db_schema dev doc fmt lint pre_commit psql run start_dependencies test
