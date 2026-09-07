# Stage 1: Base — Node + pnpm
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Keep in sync with "packageManager" in the root package.json
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

# Stage 2: Dependencies + Build
FROM base AS build
WORKDIR /app

# EXPO_PUBLIC_* env vars are inlined into the bundle at build time, so
# they must be present during `expo export`. Passed in via build-arg.
ARG EXPO_PUBLIC_POLYCENTRIC_SEED_SERVERS
ENV EXPO_PUBLIC_POLYCENTRIC_SEED_SERVERS=$EXPO_PUBLIC_POLYCENTRIC_SEED_SERVERS
# Read by app.config.ts; falls back to the package.json version.
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# CI populates packages/js-*/dist, packages/react-native/lib, and the
# packages/rs-core-wasm wasm build from upstream artifacts and sets this
# to skip the redundant `pnpm run build`. Local builds leave it unset
# and fall through to a full workspace build.
ARG SKIP_WORKSPACE_BUILD=

COPY .npmrc turbo.jsonc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches patches
COPY apps apps
COPY packages packages
COPY tools tools
# --ignore-scripts: the only dependency allowed to run install scripts is
# better-sqlite3 (see onlyBuiltDependencies), and it reaches this image only
# through @polycentric/js-node, which polycentric-app does not depend on.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN if [ -z "$SKIP_WORKSPACE_BUILD" ]; then pnpm run build; fi
# Non symlinked packages and node_modules
RUN pnpm --filter polycentric-app --prod --legacy deploy /deploy
RUN cd /deploy && npx expo export --platform web

# Stage 3: Run
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /deploy .

EXPOSE 8080
CMD ["node", "server.js"]
