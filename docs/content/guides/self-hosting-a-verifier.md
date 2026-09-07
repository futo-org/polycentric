---
title: Host a Verifier Bot
sidebar_label: Host a Verifier Bot
sidebar_position: 2
---

# Host a Verifier Bot

The verifier bot lives at `services/verifier-bot` in the Harbor monorepo.

## With Docker Compose (local development)

The repo's root `compose.yml` includes a `verifier-bot` service built from
`services/verifier-bot/Dockerfile.dev`. That image is **self-contained**: it
builds every dependency from source (the Rust→wasm `rs-core-wasm`, the JS
SDKs, and the bot), so no prebuilt artifacts are needed.

```bash
# from the repo root
cp services/verifier-bot/.env.example services/verifier-bot/.env   # then edit
docker compose up -d verifier-bot
```

The bot listens on port `3002` by default (`POLYCENTRIC_VERIFIER_BOT_PORT`).

## Production image

`services/verifier-bot/Dockerfile` is the production image built in CI. Unlike
the dev image, it consumes the `js-core` / `js-node` / `rs-core-wasm`
`dist/` produced by the CI SDK jobs rather than building them. Both images
compile the bot with `tsc` and run it with `node dist/app.js` (no tsx at
runtime).

## Environment variables

All configuration is via environment variables prefixed with
`POLYCENTRIC_VERIFIER_BOT_`. Copy `services/verifier-bot/.env.example` to `.env`
and fill it in.

### Core

| Variable | Description |
|---|---|
| `POLYCENTRIC_VERIFIER_BOT_SERVERS` | Harbor server(s) to sync with. Comma-delimited for multiple. |
| `POLYCENTRIC_VERIFIER_BOT_DATABASE_URL` | Postgres connection string (`?schema=<name>` scopes the tables). Unset uses a local sqlite file under `./state`. |
| `POLYCENTRIC_VERIFIER_BOT_ALLOWED_ORIGINS` | Comma-delimited CORS allow-list. |
| `POLYCENTRIC_VERIFIER_BOT_ALLOWED_CALLBACKS` | Comma-delimited callback URL prefixes the OAuth callback may redirect to (native app deep links). |
| `POLYCENTRIC_VERIFIER_BOT_OAUTH_CALLBACK_DOMAIN` | Public base domain of this bot, used to build OAuth callback URLs. |
| `POLYCENTRIC_VERIFIER_BOT_PUPPETEER_EXECUTABLE_PATH` | Path to a Chrome/Chromium binary for the headless-browser verifiers (e.g. Kick). |
| `POLYCENTRIC_VERIFIER_BOT_PROFILE_NAME` | Display name published for the bot's identity on first run. |
| `POLYCENTRIC_VERIFIER_BOT_PROFILE_DESCRIPTION` | Profile description published alongside the name. |
| `POLYCENTRIC_VERIFIER_BOT_HEALTH_CHECK_INTERVAL_SECONDS` | How often every platform's health check runs (default `900`). `0` disables the loop. |

### OAuth credentials

Only needed for the OAuth platforms you enable. Each is a
`_CLIENT_ID` / `_CLIENT_SECRET` pair (X uses `_API_KEY` / `_API_SECRET`):

- `POLYCENTRIC_VERIFIER_BOT_DISCORD_CLIENT_ID` / `_CLIENT_SECRET`
- `POLYCENTRIC_VERIFIER_BOT_X_API_KEY` / `_API_SECRET`
- `POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_ID` / `_CLIENT_SECRET`
- `POLYCENTRIC_VERIFIER_BOT_INSTAGRAM_CLIENT_ID` / `_CLIENT_SECRET`
- `POLYCENTRIC_VERIFIER_BOT_PATREON_CLIENT_ID` / `_CLIENT_SECRET`

`.env.example` is the authoritative, up-to-date list.

## Metrics and health checks

`GET /metrics` serves Prometheus metrics, all prefixed `verifier_bot_`:

| Metric | Labels | Meaning |
|---|---|---|
| `verifier_bot_http_requests_total` / `_http_request_duration_seconds` | `platform`, `endpoint`, `status` | Requests by platform route and endpoint (`verify`, `check`, `url`, `token`, `health-check`, ...). |
| `verifier_bot_verifications_total` / `_verification_duration_seconds` | `platform`, `verifier`, `outcome` | Verify requests. `outcome` is `ok`, `rejected` (token not found), `bad_request`, `claim_fetch_failed`, `schema_mismatch`, `platform_mismatch` or `publish_failed`. |
| `verifier_bot_health_checks_total` / `_health_check_duration_seconds` | `platform`, `verifier`, `outcome` | Health check runs, `ok` / `failed` / `error`. |
| `verifier_bot_health_check_up` | `platform`, `verifier` | `1` when the platform's last health check passed. |
| `verifier_bot_health_check_last_success_timestamp_seconds` | `platform`, `verifier` | When the platform last passed. |
| `verifier_bot_oauth_sessions_pending` | | OAuth sign-ins started but not yet called back. |

Every verifier's `healthCheck` runs on boot and then every
`POLYCENTRIC_VERIFIER_BOT_HEALTH_CHECK_INTERVAL_SECONDS`. Text verifiers fetch
a known profile and parse a known URL; OAuth verifiers confirm their
credentials are set. `GET /platforms/<slug>/<type>/health-check` runs one on
demand and records it the same way. The Harbor Grafana dashboard for these
lives in `harbor-o11y` (`dashboards/harbor-verifier-bot.json`).
