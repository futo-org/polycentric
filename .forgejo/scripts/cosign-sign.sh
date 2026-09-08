#!/usr/bin/env bash
# cosign-sign.sh <image ref>...
# Signs each ref by digest (index children included) with COSIGN_PRIVATE_KEY,
# the base64 PEM key harbor-infra mints and publishes as an Actions secret.
# The clusters verify with the matching public key and ignore Rekor, so
# nothing is uploaded to the public transparency log. Without the key (fork
# PRs get no secrets) this is a no-op.
set -euo pipefail

if [[ -z ${COSIGN_PRIVATE_KEY:-} ]]; then
  echo "COSIGN_PRIVATE_KEY unset; not signing: $*" >&2
  exit 0
fi

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
printf '%s' "$COSIGN_PRIVATE_KEY" | base64 -d > "$dir/key.pem"
export COSIGN_PASSWORD=""
cosign import-key-pair --key "$dir/key.pem" --output-key-prefix "$dir/cosign" >/dev/null
for ref in "$@"; do
  cosign sign --yes --tlog-upload=false --recursive --key "$dir/cosign.key" "$ref"
done
