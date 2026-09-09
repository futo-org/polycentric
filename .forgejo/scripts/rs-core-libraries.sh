#!/usr/bin/env bash
# The rs-core libraries (wasm, android, ios) a run did not build come from
# their develop copies in the registry, ci/rs-core-<name>:develop, which
# develop.yml refreshes when their sources change.
#
# Usage: rs-core-libraries.sh fetch [name...]     default: all three
#        rs-core-libraries.sh publish name...     needs the registry-login action first
# Env: REGISTRY.
set -euo pipefail

# a build-only path that shows the library is present
marker() {
  case $1 in
    wasm) echo packages/rs-core-wasm/dist ;;
    android) echo packages/react-native/android/src/main/jniLibs ;;
    ios) echo packages/react-native/PolycentricReactNativeFramework.xcframework/ios-arm64 ;;
    *) echo "unknown library $1" >&2; exit 2 ;;
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
  echo "$REGISTRY/ci/rs-core-$1:develop"
}

fetch() {
  for name in "$@"; do
    if [ -e "$(marker "$name")" ]; then
      echo "$name: built by this run"
      continue
    fi
    echo "$name: from $(image "$name")"
    crane digest "$(image "$name")" >/dev/null 2>&1 || { echo "::error::$(image "$name") does not exist yet; run develop.yml"; exit 1; }
    crane export "$(image "$name")" - | tar -x $(paths "$name")
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
case "$mode" in
  fetch) fetch "${@:-wasm android ios}" ;;
  publish) [ $# -gt 0 ] && publish "$@" || { echo "usage: $0 publish name..." >&2; exit 2; } ;;
  *) echo "usage: $0 fetch [name...]|publish name..." >&2; exit 2 ;;
esac
