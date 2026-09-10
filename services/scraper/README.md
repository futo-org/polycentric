# Polycentric Scraper Service

This project serves as a queryable service enabling Polycentric servers to utilize the Metascraper library to scrape relevant metadata from hyperlinks. 

## SSRF Protection

This service queries user submitted URLs, and thus care must be taken to avoid introducing Server Side Request Forgery (SSRF) vulnerabilities. To protect against this, the scraper service container should be kept on its own, isolated network. The service also includes an nftables ruleset updated via the Team Cymru aggregated IPv4 bogon list to provide defense in depth.

## Observability

Logs are JSON lines on stdout (`LOG_FORMAT=text` for a terminal, `LOG_LEVEL`
to filter), shaped like the Rust services' tracing output: `timestamp`,
`level`, `target`, `message` plus flat fields. Targets:

- `access` - one line per request: `path`, `status`, `latency_ms`, `host`
  (target host), `outcome`, `upstream_status`, `bytes`. `/health` and
  `/metrics` only at DEBUG.
- `scrape` - one line per scrape: `host`, `mode` (`fetch`/`prerender`),
  `attempts`, `status` (last upstream status), `outcome`
  (`ok`/`upstream_status`/`error`), `latency_ms`, `fields` returned.
- `browser`, `server` - lifecycle.

Prometheus metrics on `/metrics` (all `scraper_*`, plus Node defaults labelled
`service="scraper"`): request counts/latency/in-flight per path, scrapes and
latency by mode and outcome, upstream status class per attempt, retries,
metadata field yield, throttle wait, open browser contexts, image proxy
outcomes/latency/size. Target hosts are never a label - use the logs for
per-host views. The Grafana dashboard lives in harbor-ops
(`kubernetes/apps/base/grafana/dashboard-harbor-scraper.yaml`).
