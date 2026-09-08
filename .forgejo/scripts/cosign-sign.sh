#!/usr/bin/env bash
# cosign-sign.sh <image ref>...
# Signs each ref by digest (index children included) with COSIGN_PRIVATE_KEY,
# the base64 PEM key harbor-infra mints and publishes as an Actions secret.
# Without the key (fork PRs get no secrets) this is a no-op.
#
# The three sign flags matter and are accepted by both cosign 2.x and 3.x:
#   --use-signing-config=false  3.x otherwise resolves a Sigstore signing
#                               config and then rejects --tlog-upload=false
#   --tlog-upload=false         nothing goes to the public Rekor log, which
#                               would publish our image names and digests;
#                               source-controller sets IgnoreTlog with a key
#   --new-bundle-format=false   writes the classic `sha256-<digest>.sig` tag
#                               (simplesigning). Flux probes for bundles and
#                               falls back to this format, the well-trodden
#                               path; the bundle path runs its attestation
#                               verifier instead.
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
  cosign sign --yes --recursive --key "$dir/cosign.key" \
    --use-signing-config=false --tlog-upload=false --new-bundle-format=false "$ref"
done
