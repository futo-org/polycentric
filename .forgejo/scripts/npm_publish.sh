#!/usr/bin/env bash
#
# Publishes every @polycentric package to the GitLab package registry and,
# when NPM_TOKEN is set, to public npm. Packages are published one at a time
# so a version that already exists is skipped instead of aborting the whole
# release (and blocking the packages ordered after it), keeping re-runs
# idempotent.
#
# Env:
#   CI_COMMIT_TAG    release tag, e.g. v2.0.2 (the leading "v" is stripped)
#   CI_SERVER_HOST   GitLab host for the project package registry
#   CI_PROJECT_ID    GitLab project id for the project package registry
#   NPM_TOKEN        public npm auth token; public publish is skipped if unset
# Without CI_SERVER_HOST only the public publish runs.
set -euo pipefail

cd "$(dirname "$0")/../.."

VERSION="${CI_COMMIT_TAG#v}"
echo "Publishing @polycentric packages at version ${VERSION}"

# Keep prereleases (e.g. 2.0.0-alpha.1) off the `latest` dist-tag.
DIST_TAG=latest
if echo "$VERSION" | grep -q '-'; then
  DIST_TAG=$(echo "$VERSION" | sed -E 's/.*-([a-zA-Z]+).*/\1/')
  [ "$DIST_TAG" = "$VERSION" ] && DIST_TAG=next
fi
echo "Using npm dist-tag: ${DIST_TAG}"

# Bump every @polycentric package to the release version.
pnpm -r --filter "@polycentric/*" exec npm version "${VERSION}" --no-git-tag-version --allow-same-version

# Topological order; pnpm rewrites workspace:* -> ${VERSION} on publish.
PACKAGES="@polycentric/rs-core-wasm @polycentric/js-storage-sqlite @polycentric/js-core @polycentric/js-browser @polycentric/js-node @polycentric/react-native"

publish_all() {
  registry_url="$1"
  registry_label="$2"
  echo "Publishing to ${registry_label} (${registry_url})"
  pnpm config set @polycentric:registry "${registry_url}"
  for pkg in $PACKAGES; do
    set +e
    output=$(pnpm -r --filter "$pkg" publish --no-git-checks --access public --tag "$DIST_TAG" 2>&1)
    status=$?
    set -e
    echo "$output"
    if [ "$status" -ne 0 ]; then
      if echo "$output" | grep -qiE 'cannot publish over|previously published|already been taken|EPUBLISHCONFLICT|already exists'; then
        echo "==> ${pkg} is already published at ${VERSION} on ${registry_label}; skipping."
      else
        echo "==> ${pkg} failed to publish to ${registry_label}." >&2
        exit "$status"
      fi
    fi
  done
}

if [ -n "${CI_SERVER_HOST:-}" ]; then
  publish_all "https://${CI_SERVER_HOST}/api/v4/projects/${CI_PROJECT_ID}/packages/npm/" "the GitLab package registry"
fi

if [ -n "${NPM_TOKEN:-}" ]; then
  publish_all "https://registry.npmjs.org/" "public npm"
else
  echo "NPM_TOKEN is not set; skipping public npm publish" >&2
fi
