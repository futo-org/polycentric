# Polycentric Server

## Prerequisites

- Rust (edition 2024)
- Docker (for PostgreSQL and RustFS (Object storage))

## Getting Started

### 1. Start PostgreSQL

```sh
# In the root of the repo.
docker compose up -d postgres kafka
```

This starts PostgreSQL on port 5432 with user `postgres` and password `testing`.

### 2. Run Migrations

```sh
cd migration
DATABASE_URL=postgres://postgres:testing@localhost:5432 cargo run -- fresh
```

### 3. Setup .env file

```sh
cp .env.example .env
```

### 4. Start the Server

```sh
cargo run -p server
```

The server listens on `0.0.0.0:3000`, multiplexing gRPC (h2c), gRPC-Web,
and plain HTTP routes on the same port.

## Operator Commands

The server binary also carries maintenance commands that run against `DATABASE_URL`
and exit. Each prints what it would change; add `--yes` to apply it.

```sh
# Delete an identity, or every identity a key has signed events for,
# plus the cache rows, counts, notifications, and now-unreferenced content
# derived from them.
cargo run -p server -- delete-events --identity <hex>
cargo run -p server -- delete-events --public-key <hex> --yes

# Delete content rows no event references any more.
cargo run -p server -- prune-content --yes
```

Blob bodies nothing references any more are removed from the object store when the
`CONTENT_BLOB_OS_*` variables are set, and left in place otherwise. A running server
caches identity heads in memory, so restart it after deleting events.

## Environment Variables

All service variables are read and validated once at startup by
`src/config.rs`. A `.env` file in the working directory is loaded first.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:testing@localhost:5432` | Postgres connection URL. |
| `POLYCENTRIC_DATABASE_MAX_CONNECTIONS` | `100` | Maximum size of the Postgres connection pool. |
| `POLYCENTRIC_SERVER_NAME` | `http://localhost:3000` | Canonical URL of this server. Stamped as the source on produced Kafka events. |
| `POLYCENTRIC_ALLOW_HOSTS` | `POLYCENTRIC_SERVER_NAME` | Hosts clients may address this server as, comma-delimited — the audiences accepted on auth tokens. |
| `CDN_URL` | `http://localhost:3000` | Public URL clients use to fetch blob bodies. Reported by `ServerService.GetInfo`. |
| `POLYCENTRIC_SCRAPER_URL` | `http://localhost:8855` | Base URL of the internal scraper service (link-preview metadata and image proxy). |
| `POLYCENTRIC_MODERATION_IDENTITY` | _(unset)_ | Hex identity string of the trusted moderation service. Unset means no content labels are served. |

## Common Environment Variables

The shared `services/common` crates read their own variables.

### Object Store Client

| Variable | Default | Description |
|---|---|---|
| `CONTENT_BLOB_OS_BUCKET` | _(required)_ | S3 bucket holding uploaded blob bodies. |
| `CONTENT_BLOB_OS_REGION` | `us-east-1` | Bucket region. |
| `CONTENT_BLOB_OS_ENDPOINT` | _(unset)_ | Custom endpoint for S3-compatible stores; leave unset for AWS S3. |
| `CONTENT_BLOB_OS_FORCE_PATH_STYLE` | `false` | Set `true` for path-style addressing (required by RustFS). |
| `CONTENT_BLOB_OS_ACCESS_KEY` | _(unset)_ | Static credentials; unset uses the AWS SDK default chain. |
| `CONTENT_BLOB_OS_SECRET_KEY` | _(unset)_ | See above. |


### Kafka Client

| Variable | Default | Description |
|---|---|---|
| `POLYCENTRIC_KAFKA_BROKERS` | `localhost:9092` | Kafka bootstrap servers. |
| `POLYCENTRIC_KAFKA_CLUSTER_ID` | _(unset)_ | Prefix applied to topics and consumer group ids (`{id}.{name}`), so clusters can share a broker. |
| `POLYCENTRIC_KAFKA_SECURITY_PROTOCOL` | `PLAINTEXT` | Kafka `security.protocol`. |
| `POLYCENTRIC_KAFKA_SASL_MECHANISM` | _(unset)_ | Kafka SASL mechanism, e.g. `SCRAM-SHA-256`. |
| `POLYCENTRIC_KAFKA_SASL_USERNAME` | _(unset)_ | Kafka SASL username. |
| `POLYCENTRIC_KAFKA_SASL_PASSWORD` | _(unset)_ | Kafka SASL password. |
| `POLYCENTRIC_KAFKA_SSL_CA` | _(unset)_ | Kafka CA certificate, inline PEM. |
| `POLYCENTRIC_KAFKA_SSL_CERTIFICATE` | _(unset)_ | Kafka client certificate, inline PEM. |
| `POLYCENTRIC_KAFKA_SSL_KEY` | _(unset)_ | Kafka client key, inline PEM. |
| `POLYCENTRIC_KAFKA_BROKER_ADDRESS_FAMILY` | `any` | Kafka `broker.address.family`. |
| `POLYCENTRIC_KAFKA_AUTO_OFFSET_RESET` | `latest` | Consumer `auto.offset.reset` (used by the workers). |

### Telemetry

| Variable | Default | Description |
|---|---|---|
| `RUST_LOG` | `info` | Log filter. |
| `LOG_FORMAT` | _(auto)_ | `json` or `text`; defaults to text on a terminal, JSON otherwise. |
| `METRICS_PORT` | `9464` | Port serving Prometheus `GET /metrics`. |

## Running Integration Tests

The integration tests run against a live server, so the server must be running first.

Ensure that your environment uses the expected trusted moderator:

```
POLYCENTRIC_MODERATION_IDENTITY=020225a394cac01413ff43527f1644b1772d78d2cea873de1e8ae2f9c3c9f47b
```

```sh
# In one terminal, start the server
cargo run -p server

# In another terminal, run the tests
cargo test -p integration-tests
```

## Project Structure

```
protos/polycentric/v2/ - Protobuf definitions
services/server/
  src/            - Server source code
  entity/         - SeaORM entity models (shared by server and migration)
  migration/      - Database migrations
  tests/          - Integration tests (gRPC client tests)
```
