#!/usr/bin/env bash

# Simple health-checker / supervisor for the Rust server.
# ------------------------------------------------------
# This script keeps the server process running. If the
# server ever exits with a non-zero status code (crash),
# the script waits a few seconds and then restarts it.
#
# Usage:
#   ./scripts/health_checker.sh [cargo run args …]
#
# Environment variables:
#   MANIFEST_PATH        Path to Cargo.toml for the server (default: server/Cargo.toml)
#   RESTART_DELAY_SECONDS Seconds to wait before restart (default: 5)

set -Eeuo pipefail

# Ensure we operate from the repository root regardless of where the script is called from
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR/.."

MANIFEST_PATH="${MANIFEST_PATH:-server/Cargo.toml}"
RESTART_DELAY_SECONDS="${RESTART_DELAY_SECONDS:-5}"

# Infinite supervision loop
while true; do
  echo "[health_checker] Starting server (manifest: $MANIFEST_PATH)…"
  cargo run --manifest-path "$MANIFEST_PATH" --release "$@"
  exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    echo "[health_checker] Server exited cleanly (code 0). Supervisor exiting."
    exit 0
  fi

  echo "[health_checker] Detected non-zero exit code ($exit_code). Restarting in ${RESTART_DELAY_SECONDS}s…"
  sleep "$RESTART_DELAY_SECONDS"
done 