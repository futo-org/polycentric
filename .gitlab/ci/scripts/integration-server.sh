#!/usr/bin/env bash
#
# Run the server integration test suite.
#
# Starts PostgreSQL + RustFS + Kafka (if not already running), applies
# migrations, starts the server with a deterministic test moderator identity,
# runs `cargo test -p integration-tests`, then cleans up.
#
# Usage:
#   .gitlab/ci/scripts/integration-server.sh              # full run
#   .gitlab/ci/scripts/integration-server.sh --no-deps     # skip docker services (already up)
#   .gitlab/ci/scripts/integration-server.sh --no-cleanup  # keep server + docker running
#   .gitlab/ci/scripts/integration-server.sh --ci          # CI mode
#
# Run the server integration test suite.
#
# Starts PostgreSQL + RustFS + Kafka (if not already running), applies
# migrations, starts the server with a deterministic test moderator identity,
# runs `cargo test -p integration-tests`, then cleans up.
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"
export COMPOSE_PROJECT_NAME=harbor

# ---------------------------------------------------------------------------
# Test moderator identity (deterministic — derived from the same seed as
# `test_moderator_key()` in the integration-test crate).  Generated via:
#   seed = sha256(b"polycentric-test-moderator-seed-2026")
#   key  = Ed25519SigningKey::from_bytes(&seed)
#   Identity{rotation_keys=[PublicKey{type=Ed25519, key=pub}]} →
#     hex(sha256(prost::encode(identity)))
# ---------------------------------------------------------------------------
MODERATOR_IDENTITY="020225a394cac01413ff43527f1644b1772d78d2cea873de1e8ae2f9c3c9f47b"

NO_DEPS=false
NO_CLEANUP=false
CI_MODE=false

for arg in "$@"; do
  case "$arg" in
    --no-deps)    NO_DEPS=true ;;
    --no-cleanup) NO_CLEANUP=true ;;
    --ci)         CI_MODE=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Cleanup trap
# ---------------------------------------------------------------------------
cleanup() {
  if [ "$NO_CLEANUP" = true ]; then
    return
  fi
  echo ""
  echo "==> Cleaning up…"
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    echo "    server stopped (PID $SERVER_PID)"
  fi
  if [ "$NO_DEPS" = false ]; then
    echo "    stopping docker compose services…"
    docker compose down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# Pre-flight: purge any stale stack from a hard-killed prior job so we start
# with a clean slate (volumes, network, broker state).
docker compose down -v >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 1. Backing services (PostgreSQL, RustFS, Kafka)
# ---------------------------------------------------------------------------
if [ "$NO_DEPS" = false ]; then
  echo "==> Starting PostgreSQL, RustFS, and Kafka…"
  if [ "$CI_MODE" = true ]; then
    # CI: docker compose builds the image explicitly; --wait blocks until all
    # services are healthy.
    docker compose up -d --build --wait postgres rustfs kafka
  else
    docker compose up -d postgres rustfs rustfs-init kafka

    echo "    waiting for postgres (port 5432)…"
    for i in $(seq 1 30); do
      if (exec 3<>"/dev/tcp/localhost/5432") 2>/dev/null; then
        exec 3>&- 3<&-
        echo "    postgres ready (after ${i}s)"
        break
      fi
      if [ "$i" -eq 30 ]; then
        echo "ERROR: postgres not available within 30 seconds"
        exit 1
      fi
      sleep 1
    done

    echo "    waiting for RustFS (port 9000)…"
    for i in $(seq 1 15); do
      if curl -sf http://localhost:9000/health > /dev/null 2>&1; then
        echo "    RustFS ready (after ${i}s)"
        break
      fi
      if [ "$i" -eq 15 ]; then
        echo "ERROR: RustFS not available within 15 seconds"
        exit 1
      fi
      sleep 1
    done

    echo "    waiting for Kafka (port 9092)…"
    for i in $(seq 1 30); do
      if (exec 3<>"/dev/tcp/localhost/9092") 2>/dev/null; then
        exec 3>&- 3<&-
        echo "    Kafka ready (after ${i}s)"
        break
      fi
      if [ "$i" -eq 30 ]; then
        echo "ERROR: Kafka not available within 30 seconds"
        exit 1
      fi
      sleep 1
    done
  fi
  echo "    backing services ready"
fi

# ---------------------------------------------------------------------------
# 2. Start server (CI) or start server and run migrations (local)
# ---------------------------------------------------------------------------
if [ "$CI_MODE" = true ]; then
  NETWORK="${COMPOSE_PROJECT_NAME}_default"

  self_container() {
    local id
    id=$(grep -oE 'containers/[0-9a-f]{64}' /proc/self/mountinfo | head -1 | cut -d/ -f2)
    echo "${id:-$(cat /etc/hostname)}"
  }

  echo "==> Joining job container to the stack network ($NETWORK)…"
  docker network connect "$NETWORK" "$(self_container)"

  echo "==> Starting server…"
  export POLYCENTRIC_MODERATION_IDENTITY="$MODERATOR_IDENTITY"
  # --no-deps avoids pulling in the `scraper` dependency, which requires
  # NET_ADMIN for its nftables egress firewall and cannot start in CI's
  # Docker-in-Docker environment.
  if [ -n "${POLYCENTRIC_SERVER_IMAGE:-}" ]; then
    docker pull -q "$POLYCENTRIC_SERVER_IMAGE"
    docker compose up -d --no-deps --no-build --wait server
  else
    docker compose up -d --no-deps --build --wait server
  fi

  # Resolve the server container's IP on the compose network and use it
  # directly, bypassing Docker embedded DNS (which can be flaky when the job
  # container is connected to a compose network via `docker network connect`
  # in a Docker-in-Docker environment).
  SERVER_HOST=server
  SERVER_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "'${NETWORK}'").IPAddress}}' harbor-server-1 2>/dev/null)
  if [ -n "$SERVER_IP" ]; then
    SERVER_HOST=$SERVER_IP
    export POLYCENTRIC_TEST_SERVER="http://${SERVER_IP}:3000"
    echo "    server IP: ${SERVER_IP}"
  else
    export POLYCENTRIC_TEST_SERVER="${POLYCENTRIC_TEST_SERVER:-http://localhost:3000}"
    echo "    (no server IP found; using ${POLYCENTRIC_TEST_SERVER})"
  fi

  echo "    waiting for server (port ${SERVER_HOST}:3000)…"
  for i in $(seq 1 60); do
    if (exec 3<>"/dev/tcp/${SERVER_HOST}/3000") 2>/dev/null; then
      exec 3>&- 3<&-
      echo "    server ready (after ${i}s)"
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "ERROR: server did not start within 60 seconds"
      exit 1
    fi
    sleep 1
  done

  echo "==> Applying migrations via docker compose exec…"
  docker compose exec -T server /app/migration up
  echo "    migrations applied"
else
  echo "==> Applying migrations…"
  (
    cd services/server/migration
    DATABASE_URL="${DATABASE_URL:-postgres://postgres:testing@localhost:5432}" \
      cargo run -- fresh 2>&1
  )
  echo "    migrations applied"

  echo "==> Starting server…"
  export POLYCENTRIC_MODERATION_IDENTITY="$MODERATOR_IDENTITY"
  export RUST_LOG="${RUST_LOG:-info}"
  export DATABASE_URL="${DATABASE_URL:-postgres://postgres:testing@localhost:5432}"
  export CONTENT_BLOB_OS_BUCKET="${CONTENT_BLOB_OS_BUCKET:-polycentric-blobs}"
  export CONTENT_BLOB_OS_ENDPOINT="${CONTENT_BLOB_OS_ENDPOINT:-http://localhost:9000}"
  export CONTENT_BLOB_OS_FORCE_PATH_STYLE="${CONTENT_BLOB_OS_FORCE_PATH_STYLE:-true}"
  export CONTENT_BLOB_OS_ACCESS_KEY="${CONTENT_BLOB_OS_ACCESS_KEY:-rustfsadmin}"
  export CONTENT_BLOB_OS_SECRET_KEY="${CONTENT_BLOB_OS_SECRET_KEY:-rustfsadmin}"
  # Kafka is reached on the EXTERNAL listener for local connections.
  export POLYCENTRIC_KAFKA_BROKERS="${POLYCENTRIC_KAFKA_BROKERS:-localhost:9092}"
  # The test crate reads this to know where to reach the server.
  export POLYCENTRIC_TEST_SERVER="${POLYCENTRIC_TEST_SERVER:-http://localhost:3000}"

  cargo run -p server &
  SERVER_PID=$!
  echo "    server PID $SERVER_PID"

  # Wait for the HTTP health endpoint.
  echo "    waiting for server (compile + boot can take several minutes)…"
  for i in $(seq 1 300); do
    if (exec 3<>"/dev/tcp/localhost/3000") 2>/dev/null; then
      exec 3>&- 3<&-
      echo "    server ready (after ${i}s)"
      break
    fi
    if [ "$i" -eq 300 ]; then
      echo "ERROR: server did not start within 300 seconds"
      exit 1
    fi
    sleep 1
  done
fi

# ---------------------------------------------------------------------------
# 3. Run the integration test suite
# ---------------------------------------------------------------------------
echo ""
echo "==> Running integration tests…"
if [ "$CI_MODE" = true ]; then
  # nextest's `ci` profile writes a JUnit report the CI job uploads to GitLab.
  cargo nextest run -P ci -p integration-tests 2>&1
else
  cargo test -p integration-tests 2>&1
fi
echo ""
echo "==> Tests completed"
