#!/usr/bin/env bash
# Writes exists=true|false to GITHUB_OUTPUT for <REGISTRY>/<image>:<tag> (curl only).
#
# Usage: image-exists.sh <image> [tag]   Env: REGISTRY, GITHUB_SHA (default tag).
set -euo pipefail

image=$1
tag=${2:-$GITHUB_SHA}
host=${REGISTRY%%/*}
path=${REGISTRY#*/}

if curl -fsSI \
  -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
  "https://$host/v2/$path/$image/manifests/$tag" >/dev/null 2>&1; then
  echo "$image:$tag exists"
  echo "exists=true" >> "$GITHUB_OUTPUT"
else
  echo "$image:$tag missing"
  echo "exists=false" >> "$GITHUB_OUTPUT"
fi
