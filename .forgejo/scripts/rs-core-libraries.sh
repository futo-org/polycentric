#!/usr/bin/env bash
# rs-core libraries this run did not build come from the default branch's
# copy, an image in the registry; default-branch runs republish it complete.
#
# Usage: rs-core-libraries.sh fetch|publish
# Env: REGISTRY, DEFAULT_BRANCH; publish needs the registry-login action first.
set -euo pipefail

image="${REGISTRY}/ci/rs-core-libraries:${DEFAULT_BRANCH:-develop}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# job name, then the paths its artifact restores
LIBS=(
  "rs-core-wasm-build packages/rs-core-wasm/dist packages/rs-core-wasm/src/generated/wasm"
  "rn-android-build packages/react-native/android/src/main/jniLibs"
  "rn-ios-build packages/react-native/PolycentricReactNativeFramework.xcframework packages/react-native/ios"
)

fetch() {
  missing=()
  for lib in "${LIBS[@]}"; do
    set -- $lib
    name=$1; shift
    if [ -e "$1" ]; then
      echo "$name: built by this run"
    else
      echo "$name: from $image"
      missing+=("$@")
    fi
  done
  [ ${#missing[@]} -eq 0 ] || crane export "$image" - | tar -x "${missing[@]}"
}

publish() {
  paths=()
  for lib in "${LIBS[@]}"; do
    set -- $lib
    shift
    paths+=("$@")
  done
  tar cf "$tmp/libs.tar" "${paths[@]}"
  crane append -f "$tmp/libs.tar" -t "$image"
}

case "${1:-}" in
  fetch) fetch ;;
  publish) publish ;;
  *) echo "usage: $0 fetch|publish" >&2; exit 2 ;;
esac
