# Stage 1: Base - Node + pnpm
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate

# Stage: Bogon snapshot - fetch the Team Cymru aggregated IPv4 bogon list at
# build time and emit it as an nft `define` ($BOGON4). Baking the snapshot into
# the image keeps the egress firewall free of any runtime network dependency.
# `test -s` + the RFC1918 grep fail the BUILD (never the running container) if
# the feed is unreachable or returns garbage, so the egress set can't silently
# ship empty/weak. The reserved-IP list is RFC-stable, so refreshes are rare:
# bump BOGONS_REV (or build with --no-cache) to bust the layer cache and re-pull.
FROM debian:bookworm-slim AS bogons
ARG BOGONS_REV=2026-06-22
RUN echo "bogon snapshot rev: ${BOGONS_REV}" \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://www.team-cymru.org/Services/Bogons/bogon-bn-agg.txt -o /tmp/bogon4.txt \
  && test -s /tmp/bogon4.txt \
  && awk 'BEGIN { print "define BOGON4 = {" } /^[0-9]+\./ { printf "  %s,\n", $0 } END { print "}" }' \
       /tmp/bogon4.txt > /bogons.nft \
  && grep -q '^  10.0.0.0/8,' /bogons.nft

# Stage 2: Dependencies + Build
FROM base AS build
WORKDIR /app

# Don't let puppeteer download its own Chromium during install - the runtime
# image provides a system Chromium (see PUPPETEER_EXECUTABLE_PATH in the run
# stage).
ENV PUPPETEER_SKIP_DOWNLOAD=1

# Only the workspace pieces the scraper needs: the root manifests, patches,
# `tools` (for @polycentric/tsconfig), and the service itself. The other
# workspace packages (apps/*, packages/*) are absent here - pnpm tolerates
# missing workspace members and installs only what's present.
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches patches
COPY tools tools
COPY services/scraper services/scraper

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @polycentric/scraper build
# Flatten into a self-contained, non-symlinked prod node_modules + package.json.
# `allowUnusedPatches`: the workspace's patchedDependencies target frontend
# packages (expo, uniffi-bindgen-react-native) not present in this slim build,
# which `deploy` would otherwise reject.
RUN pnpm --filter @polycentric/scraper --prod --legacy \
  --config.allowUnusedPatches=true deploy /deploy

# Stage 3: Run
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# System Chromium provided below; puppeteer/browserless launch it.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# PORT is supplied at runtime (compose / `docker run -e PORT=…`); the service
# falls back to 8855 when unset.

# Headless Chromium for prerendering (Debian `chromium` → /usr/bin/chromium),
# nftables for the startup egress firewall, and curl for in-container debugging
# (e.g. testing egress rules from inside the scraper's netns).
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium nftables \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /app/services/scraper/dist ./dist
COPY services/scraper/egress.nft /etc/scraper-egress.nft
COPY --from=bogons /bogons.nft /etc/scraper-bogons.nft
COPY services/scraper/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# The entrypoint runs as root to apply the egress firewall, then drops to the
# unprivileged `node` user to run the service. REQUIRES `--cap-add=NET_ADMIN`
# (and `--init` is recommended so the headless-Chromium children get reaped).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
EXPOSE 8855
CMD ["node", "dist/index.js"]
