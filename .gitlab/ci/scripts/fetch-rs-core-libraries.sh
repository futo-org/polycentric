#!/bin/sh
# Fetches any rs-core library this pipeline didn't build from the newest
# successful run of its build job on the default branch. The pipeline's own
# status is ignored: default-branch pipelines that build rs-core stay blocked
# on the manual production jobs, so the ref-based artifacts endpoint (latest
# *successful pipeline*) would hand out stale libraries.
set -eu

api="${CI_API_V4_URL}/projects/${CI_PROJECT_ID}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# latest_job NAME -> id of the newest successful NAME job on the default branch
latest_job() {
  curl -sSf "$api/pipelines?ref=${CI_DEFAULT_BRANCH}&per_page=50" | jq -r '.[].id' |
    while read -r pipeline; do
      id=$(curl -sSf "$api/pipelines/$pipeline/jobs?scope%5B%5D=success&per_page=100" |
        jq -r --arg name "$1" 'map(select(.name == $name))[0].id // empty')
      if [ -n "$id" ]; then
        echo "$id"
        break
      fi
    done
}

download() {
  url="$api/jobs/$1/artifacts"
  status=$(curl -sSL -o "$2" -w '%{http_code}' --header "JOB-TOKEN: ${CI_JOB_TOKEN}" "$url")
  # A job token from an unprotected ref can't read a protected ref's
  # artifacts; the project is public, so fetch them without one.
  if [ "$status" != 200 ]; then
    echo "$url: $status with job token, retrying anonymously" >&2
    status=$(curl -sSL -o "$2" -w '%{http_code}' "$url")
  fi
  if [ "$status" != 200 ]; then
    echo "$url: $status" >&2
    return 1
  fi
}

# restore JOB PATH
restore() {
  if [ -e "$2" ]; then
    echo "$1: built by this pipeline"
    return
  fi
  id=$(latest_job "$1")
  if [ -z "$id" ]; then
    echo "$1: no successful job on ${CI_DEFAULT_BRANCH}" >&2
    return 1
  fi
  echo "$1: from ${CI_DEFAULT_BRANCH} job $id"
  download "$id" "$tmp/$1.zip"
  unzip -oq "$tmp/$1.zip"
}

restore rs-core-wasm-build packages/rs-core-wasm/dist
restore rn-android-build packages/react-native/android/src/main/jniLibs
restore rn-ios-build packages/react-native/PolycentricReactNativeFramework.xcframework
