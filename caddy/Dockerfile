FROM caddy:builder AS builder
# Build Caddy with caching support using the mpolden/caddy-cache module.
# This module enables the caching directives defined in the Caddyfile.
RUN xcaddy build --with github.com/caddyserver/cache-handler --with github.com/darkweak/storages/badger/caddy

FROM caddy:latest
# Replace the stock caddy binary with our custom build that supports caching.
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

