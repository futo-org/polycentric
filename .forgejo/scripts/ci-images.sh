#!/usr/bin/env bash
# CI toolchain images, tagged by the content hash of .gitlab/images.
#
#   ci-images.sh check [name...]   writes images_missing=true|false to GITHUB_OUTPUT (curl only)
#   ci-images.sh build [name...]   builds the missing ones (crane + docker, registry-login done)
#
# Names: rust rust-dind rust-android (default: all). Env: REGISTRY, TAG.
set -euo pipefail

mode=${1:-}; shift || true
[ $# -gt 0 ] || set -- rust rust-dind rust-android
host=${REGISTRY%%/*}
path=${REGISTRY#*/}

check() {
  missing=false
  for name in "$@"; do
    if curl -fsSI \
      -H 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
      "https://$host/v2/$path/ci/$name/manifests/$TAG" >/dev/null 2>&1; then
      echo "ci/$name:$TAG exists"
    else
      echo "ci/$name:$TAG missing"
      missing=true
    fi
  done
  echo "images_missing=$missing" >> "$GITHUB_OUTPUT"
}

# zot drops an in-flight upload session now and then ("blob upload unknown to
# registry"), most readily when identical blobs are uploaded concurrently, as
# a two-tag push does. So: one tag per push, retag server-side, and retry the
# push; completed layers are reused, only the failed one is re-sent.
build_image() {
  name=$1; shift
  if crane manifest "$REGISTRY/ci/$name:$TAG" >/dev/null 2>&1; then
    echo "ci/$name:$TAG exists"
    return
  fi
  for attempt in 1 2 3; do
    docker buildx build --push "$@" \
      --cache-from "type=registry,ref=$REGISTRY/ci/$name:latest" \
      --cache-to type=inline \
      --tag "$REGISTRY/ci/$name:$TAG" \
      ".gitlab/images/$name" && break
    [ "$attempt" -lt 3 ] || { echo "ci/$name:$TAG: push failed after $attempt attempts" >&2; exit 1; }
    echo "ci/$name:$TAG: push failed, retrying ($attempt/3)" >&2
    sleep 15
  done
  crane tag "$REGISTRY/ci/$name:$TAG" latest
}

build() {
  for name in "$@"; do
    case "$name" in
      rust) build_image rust ;;
      rust-dind | rust-android) build_image "$name" --build-arg "RUST_IMAGE=$REGISTRY/ci/rust:$TAG" ;;
      *) echo "unknown image $name" >&2; exit 2 ;;
    esac
  done
}

case "$mode" in
  check) check "$@" ;;
  build) build "$@" ;;
  *) echo "usage: $0 check|build [name...]" >&2; exit 2 ;;
esac
