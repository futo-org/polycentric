#!/usr/bin/env bash
# rs-core libraries a run did not build come from the registry: the commit's
# copy when a run published it, else the default branch's (develop.yml retags
# the commit's copy once it lands).
#
# Usage: rs-core-libraries.sh fetch|publish
# Env: REGISTRY, GITHUB_SHA, DEFAULT_BRANCH; publish needs the registry-login action first.
set -euo pipefail

repo="${REGISTRY}/ci/rs-core-libraries"
commit="$repo:${GITHUB_SHA}"
default="$repo:${DEFAULT_BRANCH:-develop}"
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
      echo "$name: from the registry"
      missing+=("$@")
    fi
  done
  [ ${#missing[@]} -gt 0 ] || return 0
  image=$default
  crane digest "$commit" >/dev/null 2>&1 && image=$commit
  echo "fetching from $image"
  crane export "$image" - | tar -x "${missing[@]}"
}

publish() {
  paths=()
  for lib in "${LIBS[@]}"; do
    set -- $lib
    shift
    paths+=("$@")
  done
  tar cf "$tmp/libs.tar" "${paths[@]}"
  crane append -f "$tmp/libs.tar" -t "$commit"
}

case "${1:-}" in
  fetch) fetch ;;
  publish) publish ;;
  *) echo "usage: $0 fetch|publish" >&2; exit 2 ;;
esac
