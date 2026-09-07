#!/usr/bin/env bash
# Restore or save workspace paths as a tarball in the R2 cache bucket
# (cache/<key>.tar.zst), immutable per key. No-op without SCCACHE_R2_*.
# Usage: r2-cache.sh restore|save <key> <path>...
set -euo pipefail

mode=$1 key=$2
shift 2

if [ -z "${SCCACHE_R2_BUCKET:-}" ]; then
  echo "r2-cache: no bucket configured"
  exit 0
fi
url="$SCCACHE_R2_ENDPOINT/$SCCACHE_R2_BUCKET/cache/$key.tar.zst"
sign=(--aws-sigv4 aws:amz:auto:s3 --user "$SCCACHE_R2_ACCESS_KEY_ID:$SCCACHE_R2_SECRET_ACCESS_KEY")
# S3 needs the payload hash header; the image's curl 7.88 does not add it.
empty=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
tarball=$(mktemp)
body=$(mktemp)
trap 'rm -f "$tarball" "$body"' EXIT
cd "$GITHUB_WORKSPACE"

# request <curl args...>: prints the status (000 on a transport error) and
# keeps the response in $body.
request() {
  curl -sS --connect-timeout 15 --max-time 900 "${sign[@]}" -o "$body" -w '%{http_code}' "$@" "$url" || true
}
report() {
  echo "r2-cache: $1 $2 for $key" >&2
  head -c 1000 "$body" >&2
  echo >&2
}

case "$mode" in
  restore)
    status=$(request -H "x-amz-content-sha256: $empty")
    case "$status" in
      200)
        zstd -dc "$body" | tar x
        echo "r2-cache: restored $key ($(du -h "$body" | cut -f1))"
        ;;
      404) echo "r2-cache: no entry for $key" ;;
      *) report GET "$status" ;;
    esac
    ;;
  save)
    status=$(request -I -H "x-amz-content-sha256: $empty")
    case "$status" in
      200)
        echo "r2-cache: $key exists"
        exit 0
        ;;
      404) ;;
      *)
        report HEAD "$status"
        exit 1
        ;;
    esac
    tar c --ignore-failed-read "$@" | zstd -T0 -q -f -o "$tarball"
    sha=$(sha256sum "$tarball" | cut -d' ' -f1)
    status=$(request -T "$tarball" -H "content-type: application/zstd" -H "x-amz-content-sha256: $sha")
    if [ "$status" != 200 ]; then
      report PUT "$status"
      exit 1
    fi
    echo "r2-cache: saved $key ($(du -h "$tarball" | cut -f1))"
    ;;
  *)
    echo "r2-cache: mode must be restore or save" >&2
    exit 2
    ;;
esac
