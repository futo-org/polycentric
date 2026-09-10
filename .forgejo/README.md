# CI

Forgejo Actions. Images and charts go to `registry.futo.org/harbor`, JS
packages to npm, releases to Forgejo releases. Workflows, actions, scripts
and the CI toolchain images (`images/`) all live here.

## Workflows

| Workflow | Runs on | Does |
|---|---|---|
| `pr.yml` | pull requests | lint, package, image and docs builds, unit, integration and e2e tests, docs preview |
| `pr-app.yml` | `PR / Build App` label on a PR, or `PR / Build App / Android APK`, `PR / Build App / Android AAB`, `PR / Build App / iOS` for one target | staging EAS builds |
| `pr-docs-cleanup.yml` | PR closed | remove the docs preview |
| `deploy-<component>-staging.yml` | push to `develop` touching the component, manual run | staging deploy |
| `deploy-<component>-production.yml` | manual | production deploy |
| `release.yml` | `v*` and `app-*` tags | packages, images, production apps, the release |

Shared steps are composite actions in `.forgejo/actions`; a job is a
container, a checkout and an action. `pr.yml` starts with `changes.mjs` (the
plan: which jobs run, from the changed paths) and builds missing CI images.

Rules:

- A `pr.yml` job runs when its paths changed, or the workflow (or an action
  or script it uses) changed. Tags build everything.
- Images are pushed as `<image>:<sha>`; every run builds the ones it needs
  and BuildKit's registry cache decides what that costs.
- The rs-core libraries (wasm, Android, iOS) are pushed as
  `ci/rs-core-<name>:<key>`, the key a hash of the sources that produce that
  library (`rs-core-libraries.sh`). A job takes the copy for its sources and
  builds the library only when there is none, so a squash commit shares its
  PR's copy and a copy for other sources is never used. Web and the verifier
  bot need only wasm, the app only Android and iOS.
- `pr.yml`'s last job, `Complete`, fails if any job in the run did. It is the
  required status check on `develop` (`PR / Complete (pull_request)`, set in
  harbor-infra `futo-git/org`), so a PR that ran nothing still reports.

## Deploys

Components: `server`, `moderation`, `push-notifications`, `scraper`,
`verifier-bot`, `web`, `app`, `docs`.

`deploy-<component>-staging.yml` runs on a push to `develop` that touches the
component's paths (or the workflow and the actions it uses), and manually. A
service deploy builds the commit's image (BuildKit's registry cache makes a
rebuild of unchanged sources a matter of seconds; `web` and `verifier-bot`
first build the SDKs, and wasm when its copy is missing), packages and pushes
the component's chart as
`<next patch>-<ref>.g<sha>` with the commit as `appVersion`, then moves the
image and chart `staging` tags. helm-controller watches the chart tag. `web`
also uploads its bundle to the static bucket. `app` builds the staging apps on
EAS and submits them; `ios_e2e` runs the iOS suite on the store build. `docs`
deploys to Cloudflare Pages.

`deploy-<component>-production.yml` moves the `staging` image and chart tags
to `production`, so production gets what staging runs. `sha` deploys that
commit instead; its image and chart must exist, and a commit has a chart only
for the components deployed at it. `deploy-app-production.yml` builds the
production apps from `develop`'s head and submits them.

`node .forgejo/scripts/deployed.mjs` prints the commit each chart's `staging`
and `production` tag pins, no login needed.

## Runners

Repository variables with defaults: `CI_RUNNER` (`docker`), `CI_RUNNER_MACOS`
(`macos`), `CI_RUNNER_IOS_DEVICE` (`ios-device`), `CI_NODE_IMAGE`
(`node:24-bookworm`), `CI_TOOLS_IMAGE` (`node:24-alpine`), `CI_REGISTRY`.

The docker runner must mount the docker socket into job containers (compose
integration tests, service containers, the CI image builds). The mac
runners are the Tart VM (`ios-build`) and the device mac with the ad-hoc
profile and Maestro (`ios-e2e`).

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

Image builds run rootless BuildKit inside the job container (`ci/buildkit`,
`buildctl-daemonless.sh`), no docker daemon involved, so nothing survives the
job: they read and write the registry cache `<image>:cache-develop` with
`mode=max`, and a build resumes from the step that changed. Rootless BuildKit
needs the runner to start job containers with seccomp and AppArmor unconfined
(harbor-ops runner config).

## Forgejo notes

- Artifacts need `forgejo/upload-artifact@v4` and
  `forgejo/download-artifact@v4`, and stay inside one workflow run.
- A job's `if` is evaluated by the runner, so a skipped job on a label with
  no online runner waits forever.
- An empty matrix creates no job and blocks anything that `needs` it.
- No `workflow_run` event, so a deploy cannot follow a CI run; it checks the
  registry for the commit's image instead.
