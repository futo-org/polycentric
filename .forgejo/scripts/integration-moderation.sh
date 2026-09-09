#!/usr/bin/env bash
#
# Runs the server stack with Docker, then runs the moderation service
# end-to-end CSAM test using cargo.
#
# Env:
#   KEEP_STACK=1   leave the Docker stack running on exit (default: tear down)
set -euo pipefail

cd "$(dirname "$0")/../../.."

# A fixed project name keeps the network name (<project>_default) independent
# of the checkout directory, for both the connect below and teardown.
export COMPOSE_PROJECT_NAME=harbor
NETWORK="${COMPOSE_PROJECT_NAME}_default"

# Host:port the readiness probe waits on (and, locally, the test connects to).
SERVER_HOST=localhost
SERVER_PORT=3000

# The job's own container ID. GitLab sets the build container's hostname to a
# short predefined name (runner-…-concurrent-N) that the daemon does not know
# it by, so `docker network connect <hostname>` fails. Recover the real 64-hex
# ID from the bind mounts Docker sets up for /etc/hostname, /etc/hosts, etc.
# (sourced from /var/lib/docker/containers/<id>/…), falling back to hostname.
self_container() {
  local id
  id=$(grep -oE 'containers/[0-9a-f]{64}' /proc/self/mountinfo | head -1 | cut -d/ -f2)
  echo "${id:-$(cat /etc/hostname)}"
}

cleanup() {
  if [[ "${CI:-}" == "true" ]]; then
    docker network disconnect "$NETWORK" "$(self_container)" >/dev/null 2>&1 || true
  fi
  if [[ "${KEEP_STACK:-0}" != "1" ]]; then
    docker compose down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Clear any stack left behind by a previous job that was hard-killed before its
# cleanup trap could run (a stale broker/volume would otherwise be reused).
echo "==> Clearing any stale stack…"
docker compose down -v >/dev/null 2>&1 || true

echo "==> Bringing up infrastructure…"
# Start infrastructure services first. Notably, we avoid the scraper
# service because it's unnecessary for the test. Also, in CI's dind environment
# the scraper cannot start because its nftables egress firewall requires
# CAP_NET_ADMIN, and an exited dependency container causes compose v2 to
# return a non-zero exit code, aborting the script.
docker compose up -d --build --wait postgres rustfs kafka

echo "==> Creating object-store bucket…"
docker compose run --rm rustfs-init

if [[ "${CI:-}" == "true" ]]; then
  echo "==> Joining the job container to the stack network ($NETWORK)…"
  docker network connect "$NETWORK" "$(self_container)"
  # Reach the services by their in-network names instead of localhost. Kafka
  # is reached on its INTERNAL listener, which advertises kafka:19092 on this
  # network (the EXTERNAL listener advertises localhost:9092, for local use).
  export POLYCENTRIC_TEST_DATABASE_URL="postgres://postgres:testing@postgres:5432"
  export POLYCENTRIC_TEST_OS_ENDPOINT="http://rustfs:9000"
  export POLYCENTRIC_TEST_KAFKA_BROKERS="kafka:19092"
fi

echo "==> Building and starting the server…"
# Build and start the server without its depends_on chain (--no-deps), so
# the scraper container is not pulled in.  The infrastructure is already
# running, so this is safe.
if [ -n "${POLYCENTRIC_SERVER_IMAGE:-}" ]; then
  if ! docker pull -q "$POLYCENTRIC_SERVER_IMAGE"; then
    echo "    ${POLYCENTRIC_SERVER_IMAGE} not found, using ${POLYCENTRIC_SERVER_FALLBACK_IMAGE}"
    export POLYCENTRIC_SERVER_IMAGE="$POLYCENTRIC_SERVER_FALLBACK_IMAGE"
    docker pull -q "$POLYCENTRIC_SERVER_IMAGE"
  fi
  docker compose up -d --no-deps --no-build --wait server
else
  docker compose up -d --no-deps --build --wait server
fi

# Resolve the server container's IP on the compose network and use it
# directly, bypassing Docker embedded DNS (which can be flaky in a
# Docker-in-Docker environment when the job container is connected to the
# compose network via `docker network connect`).
if [[ "${CI:-}" == "true" ]]; then
  SERVER_HOST=server
  SERVER_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "'${NETWORK}'").IPAddress}}' harbor-server-1 2>/dev/null)
  if [ -n "$SERVER_IP" ]; then
    SERVER_HOST=$SERVER_IP
  fi
fi
export POLYCENTRIC_TEST_SERVER="http://${SERVER_HOST}:${SERVER_PORT}"

echo "==> Waiting for the server gRPC port ($SERVER_HOST:$SERVER_PORT)…"
for i in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/$SERVER_HOST/$SERVER_PORT") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "    server is accepting connections (after ${i}s)"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: server did not start within 60 seconds"
    exit 1
  fi
  sleep 1
done

echo "==> Applying server database migrations…"
docker compose exec -T server /app/migration up

# Both suites run in a single invocation so they share one JUnit report, and
# strictly one at a time: each spawns its own moderation service, which would
# otherwise contend for the same Kafka consumer group and database rows.
echo "==> Running the moderation integration tests…"
if [[ "${CI:-}" == "true" ]]; then
  # nextest's `ci` profile writes a JUnit report the CI job uploads to GitLab.
  cargo nextest run -P ci -p moderation-service \
    --test csam_pipeline --test report_label_pipeline \
    --run-ignored ignored-only --no-capture --test-threads 1
else
  cargo test -p moderation-service \
    --test csam_pipeline --test report_label_pipeline \
    -- --ignored --nocapture
fi
