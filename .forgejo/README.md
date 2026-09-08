# CI

Forgejo Actions. Images and charts go to `registry.futo.org/harbor`, JS
packages to npm, releases to Forgejo releases. The old GitLab pipeline is
disabled; its scripts (`.gitlab/ci/scripts`) and images (`.gitlab/images`)
are still used.

## Entry points

| Workflow | Runs on | Does |
|---|---|---|
| `pr.yml` | pull requests | checks, builds, tests |
| `pr-app.yml` | `build-app` label on a PR | staging EAS builds |
| `cd-staging.yml` | push to `develop`, manual run, nightly | the above plus staging deploys |
| `release.yml` | `v*` and `app-*` tags | the above plus the release |
| `cd-production.yml` | manual | promote chosen components to `production`, production app builds |
| `cd-docs-cleanup.yml` | PR closed | remove the docs preview |

Each entry point runs `changes.mjs` (the plan: which jobs run, from changed
paths and the ref), builds missing CI images, then calls the component
workflows.

## Components

| Workflow | Jobs |
|---|---|
| `ci-checks.yml` | zizmor, trivy |
| `ci-packages.yml` | rs-core and js-core checks, wasm, Android, Kotlin, iOS and JS package builds |
| `ci-rust-services.yml` | checks, images, staging deploys, integration tests |
| `ci-js-services.yml` | checks, scraper and verifier bot images, staging deploys, tests |
| `ci-app-web-checks.yml` | app and web lint and tests |
| `ci-web.yml` | web image, staging deploy, web e2e |
| `ci-app.yml` | EAS builds, store and APK deploys, iOS e2e |
| `ci-charts.yml` | chart lint and publish |
| `ci-docs.yml`, `cd-docs.yml` | docs build, Pages deploy, PR preview |
| `ci-release.yml` | release notes, npm publish, crates, image tags, release |

Forgejo lists called jobs flat, so job names are `<component> / <job>`.

Rules:

- A job runs when its paths changed, or the workflow it is in (or an action
  or script it uses) changed. Manual runs and tags run everything.
- Builds wait for their component's checks. Deploys run right after their
  build.
- Libraries a run does not build come from the develop copy in the registry.
- Only `develop` (and branches in `CI_STAGING_BRANCHES`) deploy to staging.
  Production is `cd-production.yml`.
- `pr.yml`'s last job, `Complete`, fails if any job in the run did. It is the
  required status check on `develop` (`PR / Complete (pull_request)`, set in
  harbor-infra `futo-git/org`), so a PR that ran nothing still reports.

## Manual runs

`cd-staging.yml` inputs: `eas_staging` (staging app builds), `ios_e2e`. A
manual run on `develop` builds and deploys everything.

`cd-production.yml`: tick the components to promote. Each moves the `staging`
image and chart tags to `production`, so production gets what staging runs.
`sha` deploys that commit instead; it only works for components that commit
built. `apps` builds the production apps from the ref's head and submits them
(`develop` only).

## Runners

Repository variables with defaults: `CI_RUNNER` (`docker`), `CI_RUNNER_MACOS`
(`macos`), `CI_RUNNER_IOS_DEVICE` (`ios-device`), `CI_NODE_IMAGE`
(`node:24-bookworm`), `CI_TOOLS_IMAGE` (`node:24-alpine`), `CI_REGISTRY`,
`CI_STAGING_BRANCHES`.

The docker runner must mount the docker socket into job containers. The mac
runners are the Tart VM (`rn-ios-build`) and the device mac with the ad-hoc
profile and Maestro (`app-ios-e2e`).

## Secrets and variables

Provisioned by harbor-infra (`futo-git/ci_values`, `ci_variables`).

- `REGISTRY_USER` (variable), `REGISTRY_TOKEN`: zot API key of the CI user.
- `EXPO_TOKEN`, `NPM_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `MATTERMOST_RELEASES_WEBHOOK`, `VERIFIER_BOT_ENV_VARS` (base64 `.env`).
- `STATIC_S3_ENDPOINT`, `STATIC_S3_ACCESS_KEY_ID`,
  `STATIC_S3_SECRET_ACCESS_KEY`; variables `STATIC_S3_BUCKET`,
  `STATIC_PUBLIC_BASE_URL`.
- `SCCACHE_R2_ENDPOINT`, `SCCACHE_R2_ACCESS_KEY_ID`,
  `SCCACHE_R2_SECRET_ACCESS_KEY`; variable `SCCACHE_R2_BUCKET`.
- Variables `EXPO_PUBLIC_POLYCENTRIC_SEED_SERVERS`,
  `EXPO_PUBLIC_POLYCENTRIC_VERIFIER_SERVERS`.

## Caching

Runners are ephemeral, so `actions/cache` is useless. `r2-cache` keeps
tarballs in the R2 bucket: each Rust job's cargo registry and `target/`
(keyed by rustc version and Cargo files), plus Gradle. sccache covers the
crates that still compile.

## Forgejo notes

- Artifacts need `forgejo/upload-artifact@v4` and
  `forgejo/download-artifact@v4`.
- A job's `if` is evaluated by the runner, so a skipped job on a label with
  no online runner waits forever.
- An empty matrix creates no job and blocks anything that `needs` it.
- Reusable workflows are one level deep; the entry points repeat the calls.
