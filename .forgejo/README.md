# Forgejo Actions CI

Forgejo Actions port of the GitLab pipeline (`.gitlab-ci.yml` + `.gitlab/ci/*`,
kept in place during the transition; the workflows reuse `.gitlab/ci/scripts/*`
and `.gitlab/images/*`). Images, Helm charts and the CI toolchain images go to
`registry.futo.org/harbor/...` (FUTO's zot), the JS SDKs to npmjs, and the
release with its APK, AAR and crates to Forgejo releases. Forgejo's own
package registry is not used: its workflow token cannot push packages and it
cannot mint tokens from a token.

## Workflows

`ci.yml` runs on every push and pull request. Its `changes` job runs
`.forgejo/scripts/changes.mjs`, which resolves the GitLab `rules` into a
plan: one flag per job plus the matrix rows for the grouped jobs (tags and
manual runs match every path). `setup-images` builds the CI toolchain images,
then the component workflows (`ci-*.yml` and `cd-staging.yml`,
`workflow_call` only) run, called like GitLab `include:` files. Integration
and e2e tests live with the component they test, after its build. Editing a
workflow, or an action or script it uses, reruns that workflow's jobs only
(GitLab: the job's include file); libraries a run does not build come from
the develop copy.

| Workflow | GitLab files | Jobs |
|---|---|---|
| `ci-checks.yml` | the check stage | one job per group, checks as steps: Lint / Test Rust packages (rs-core + rs-common), Check Rust services, Lint / Test JS packages (js-core), Check JS services (scraper, verifier bot), Check app, Lint charts, Lint workflows (zizmor, `.forgejo/zizmor.yml`), Scan dependencies (trivy, JSON report artifact) |
| `ci-packages.yml` | build_rs_core, build_js_sdks, build_rn_sdk, build_kt_core | rust-wasm-build, rust-android-build, kt-core-build, rn-ios-build, js-packages-build (collect rs-core libraries, JS + React Native) |
| `ci-rust-services.yml` | build_services (rust), test_server, test_moderation | service-images, services-integration |
| `ci-js-services.yml` | build_services (scraper, verifier-bot) | scraper-image, scraper-integration, verifier-bot-image (build + health check), verifier-bot-tests (+ scheduled production health) |
| `ci-app.yml` | build_app | web-image (version + image), app-web-e2e, app-eas-build, app-ios-e2e |
| `ci-charts.yml` | publish_charts | charts-build (staging branches only; other runs lint) |
| `ci-release.yml` | release | release-{changelog, publish-npm, package-rs-core, tag-images}, release |
| `cd-staging.yml` | deploy_services, deploy_app | deploy-staging, app-deploy-store, app-deploy-apk |
| `ci-docs.yml` | build_docs | docs-typecheck, docs-build |
| `cd-docs.yml` | deploy_docs | docs-deploy (Cloudflare Pages, default branch), docs-review (`pr-<n>` preview), docs-review-stop (PR closed) |

Jobs that GitLab repeats per variant are one matrix job here
(`service-images`, `app-eas-build`, `deploy-staging`, ...); the rows come
from the plan. Job ids follow the GitLab job names; the display
names are verb first (`Lint Rust packages`, `Build server image`, `Deploy web
to staging`), since Forgejo lists the expanded jobs flat.
Dependencies between components are at the call level (`app` and
`js-services` wait for `packages`, `deploy` for everything), so a failure in one
component job holds back that whole component's dependants.

`cd-production.yml` stands alone: `workflow_dispatch` replacing the GitLab
`when: manual` production deploys. Pick a component (and optionally a
commit); it relabels that commit's image and chart `production`.

Shared steps are composite actions in `.forgejo/actions/` (`rust-env`,
`setup-pnpm`, `sdk-artifacts`, `registry-login`, `service-image`,
`deploy-tag`, `eas-build`). `registry-login` writes the docker auth file
instead of calling `docker login`. Public DNS for registry.futo.org also
carries a private address the runners cannot reach; the runner droplets'
resolver (harbor-infra `futo-git/runners`) strips it for the droplet and
every container.
Artifacts use `forgejo/upload-artifact@v4` and `forgejo/download-artifact@v4`:
the upstream v4 actions refuse any server other than github.com.

A daily `schedule` runs the GitLab schedule-only jobs (scraper integration,
verifier-bot tests and the production verifier health check).

## Manual runs

`ci.yml` `workflow_dispatch` inputs stand in for the GitLab manual jobs:

- `eas_staging`: the staging EAS builds (apk, aab, ios) on any branch (GitLab:
  manual on merge requests, automatic on the default branch). On a pull
  request, the `build-app` label does the same for every push while it is set.
- `eas_production`: the production EAS builds plus store submission and APK
  feed publish; honoured on the default branch only (GitLab: manual there,
  automatic on `v*`/`app-*` tags).
- `ios_e2e`: the iOS e2e suite on the store build the run queued.

A manual run of `ci.yml` on `develop` behaves like GitLab "Run pipeline":
everything builds, staging deploys and the docs redeploy (the GitLab `docs`
tag).

Pull request runs also fire on `labeled` and `closed`. A label other than
`build-app` skips the run; closing a PR only removes its docs preview.

## Environments

- Staging: every push to `develop` deploys what changed (services, web, the
  app's store tracks and APK feed). Other branches join by listing them in
  the `CI_STAGING_BRANCHES` variable (comma separated) and in `ci.yml`'s
  `on.push.branches`.
- Production: never automatic. Services and web go through
  `cd-production.yml` (pick the component, optionally a commit); the app
  through `ci.yml` with `eas_production` on `develop`, or a `v*` / `app-*`
  tag.

## Runners

Labels and job images come from repository variables, with these defaults:

- `CI_RUNNER` (`docker`): Linux jobs. Every job sets `container:`, so the
  label's default image is irrelevant, but the runner must mount the Docker
  socket into job containers (`container.docker_host: automount` in the
  runner config) for the image builds, the integration tests, the
  verifier-bot health check and the `services:` of the web e2e job.
- `CI_RUNNER_MACOS` (`macos`): an ephemeral macOS Tart VM with Xcode
  (forgejo-tart-runner); `rn-ios-build` installs rustup and its brew tools
  itself.
- `CI_RUNNER_IOS_DEVICE` (`ios-device`): the mac with the distribution
  certificate, the ad-hoc profile at `IOS_ADHOC_PROFILE` and Maestro
  (`app-ios-e2e-*`).
- `CI_NODE_IMAGE` (`node:24-bookworm`) and `CI_TOOLS_IMAGE`
  (`node:24-alpine`, plus `apk add` per job): job containers need node and
  git for `actions/checkout`, so not node:24-slim as on GitLab.

## Secrets

All of these are provisioned by harbor-infra (`shared/futo-git/ci_values`
and `ci_variables`), not set by hand.

- `REGISTRY_USER` (variable), `REGISTRY_TOKEN`: a registry.futo.org API key
  (created in the zot UI after an SSO login) of a user with write access to
  `harbor/**`. The user is the SSO email address, zot's OpenID identity.
  Every image and chart push uses it; pulls are anonymous.
- `EXPO_TOKEN`: EAS builds and submissions.
- `NPM_TOKEN`: public npm publish on release (skipped if unset).
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`: docs Pages deploys.
- `VERIFIER_BOT_ENV_VARS`: base64-encoded `.env` for the verifier-bot tests
  (the content; GitLab used a file variable).
- `STATIC_S3_ENDPOINT`, `STATIC_S3_BUCKET`, `STATIC_S3_REGION`,
  `STATIC_S3_ACCESS_KEY_ID`, `STATIC_S3_SECRET_ACCESS_KEY`,
  `STATIC_PUBLIC_BASE_URL`: the static bucket for web assets and the APK feed.
- `MATTERMOST_RELEASES_WEBHOOK`: release announcement.
- `SCCACHE_R2_BUCKET` (variable), `SCCACHE_R2_ENDPOINT`,
  `SCCACHE_R2_ACCESS_KEY_ID`, `SCCACHE_R2_SECRET_ACCESS_KEY`: the CI cache
  bucket. The runners are ephemeral droplets, so `actions/cache` (per runner
  instance) never hits. `r2-cache` stores tarballs under `cache/`, immutable
  per key: `rust-env` restores each Rust job's cargo registry and `target/`
  (key: job, rustc version, Cargo.lock and Cargo.toml files), so unchanged
  dependencies are Fresh instead of going through sccache one crate at a
  time; the Android job adds Gradle. sccache still covers the workspace
  crates that do compile. All of it is a no-op when unset, as on fork PRs.

Repository variables: `EXPO_PUBLIC_POLYCENTRIC_SEED_SERVERS`,
`EXPO_PUBLIC_POLYCENTRIC_VERIFIER_SERVERS`, and optionally `CI_REGISTRY`
(default `registry.futo.org/harbor`) and `CI_STAGING_BRANCHES` (default the
default branch).

Pull requests from forks get no secrets, so their image pushes fail.

## Bootstrap

1. Register the runners above and set the secrets and variables.
2. Have zot allow anonymous read and the CI user's write on `harbor/**`.
3. Point helm-controller/flux at `oci://registry.futo.org/harbor/charts`.
4. Push `develop` once so the `ci/*` images and `ci/rs-core-libraries:develop`
   are published.

## Differences from GitLab

- Only `v<major>.<minor>.<patch>` and `app-*` tags trigger tag runs; the
  per-component `server-*`/`js-sdk-*`/... tags are gone.
- Release notes come from `.forgejo/scripts/release-notes.mjs` (the
  `Changelog:` trailers, grouped like `.gitlab/changelog_config.yml`). The APK,
  the AAR and the crates are release attachments; there is no Maven or private
  npm publish.
- Libraries a run does not build (`rs-core-libraries`) come from the
  `ci/rs-core-libraries:develop` image (a tar layer, `crane export`), which
  default-branch runs republish complete, instead of the latest successful
  GitLab job artifacts.
- Server and moderation integration tests run one after the other in a
  single job (GitLab: `resource_group`), since they share Compose project
  name and host ports.
- CI images are tagged by the content hash of `.gitlab/images` and only built
  when that tag is missing; GitLab rebuilt every pipeline against the runner
  host's local layer cache, which ephemeral runners do not have. Charts
  additionally get a commit SHA tag so `cd-production.yml` can relabel
  them.
- JUnit reports are plain artifacts; trivy has no code quality report.
- No pnpm store cache (the store is several GB, slower to restore than to
  download); jobs install only what they need with `pnpm install --filter
  <package>...`. The wasm and Android targets are baked into the CI images.
