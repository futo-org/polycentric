#!/usr/bin/env bash
# The rs-core libraries (wasm, android, ios) in the registry, each under a key
# hashed from its sources: ci/rs-core-<name>:<key>. A job takes the copy for
# its sources or builds it; a copy for other sources is never used.
#
# Usage: rs-core-libraries.sh check name...     writes have_<name>=true|false to GITHUB_OUTPUT (curl only)
#        rs-core-libraries.sh fetch name...     restores the ones this run did not build (crane)
#        rs-core-libraries.sh publish name...   pushes the ones this run built (crane, after registry-login)
# Env: REGISTRY.
set -euo pipefail

# the sources the library is built from
inputs() {
  case $1 in
    wasm) echo packages/rs-core packages/rs-common packages/rs-core-wasm protos Cargo.toml Cargo.lock patches .gitlab/images ;;
    android | ios) echo packages/rs-core packages/rs-common packages/react-native protos Cargo.toml Cargo.lock .gitlab/images ;;
    *) echo "unknown library $1" >&2; exit 2 ;;
  esac
}

# a build-only path that shows the library is present
marker() {
  case $1 in
    wasm) echo packages/rs-core-wasm/dist ;;
    android) echo packages/react-native/android/src/main/jniLibs ;;
    ios) echo packages/react-native/PolycentricReactNativeFramework.xcframework/ios-arm64 ;;
  esac
}

# what the library's build artifact restores
paths() {
  case $1 in
    wasm) echo packages/rs-core-wasm/dist packages/rs-core-wasm/src/generated/wasm ;;
    android) echo packages/react-native/android/src/main/jniLibs ;;
    ios) echo packages/react-native/PolycentricReactNativeFramework.xcframework packages/react-native/ios ;;
  esac
}

image() {
  key=$(for p in $(inputs "$1"); do git rev-parse "HEAD:$p"; done | sha256sum | cut -c1-16)
  echo "$REGISTRY/ci/rs-core-$1:$key"
}

check() {
  host=${REGISTRY%%/*}
  path=${REGISTRY#*/}
  for name in "$@"; do
    ref=$(image "$name")
    have=false
    curl -fsSI \
      -H 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
      "https://$host/v2/$path/ci/rs-core-$name/manifests/${ref##*:}" >/dev/null 2>&1 && have=true
    echo "$ref: $have"
    echo "have_$name=$have" >> "$GITHUB_OUTPUT"
  done
}

fetch() {
  for name in "$@"; do
    if [ -e "$(marker "$name")" ]; then
      echo "$name: built by this run"
      continue
    fi
    ref=$(image "$name")
    echo "$name: from $ref"
    crane digest "$ref" >/dev/null 2>&1 || { echo "::error::$ref does not exist; the $name build job must run"; exit 1; }
    crane export "$ref" - | tar -x $(paths "$name")
  done
}

publish() {
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  for name in "$@"; do
    [ -e "$(marker "$name")" ] || { echo "::error::$name was not built by this run"; exit 1; }
    tar cf "$tmp/$name.tar" $(paths "$name")
    crane append -f "$tmp/$name.tar" -t "$(image "$name")"
  done
}

mode=${1:-}
shift || true
[ $# -gt 0 ] || { echo "usage: $0 check|fetch|publish name..." >&2; exit 2; }
case "$mode" in
  check) check "$@" ;;
  fetch) fetch "$@" ;;
  publish) publish "$@" ;;
  *) echo "usage: $0 check|fetch|publish name..." >&2; exit 2 ;;
esac
