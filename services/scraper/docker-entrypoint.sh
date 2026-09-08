#!/bin/sh
set -eu

# Apply the egress firewall before anything else. Fail closed: if nft can't
# program the rules (e.g. the container wasn't given CAP_NET_ADMIN), refuse to
# start rather than run the scraper with unrestricted egress.
echo "scraper: applying egress firewall"
nft -f /etc/scraper-egress.nft

# Allow DNS only to the resolver(s) this container is configured with - they
# often sit in an otherwise-blocked range (VPC resolver in 10/8, etc.), so
# without this the internal-range drops would break name resolution.
for ns in $(awk '/^nameserver/ { print $2 }' /etc/resolv.conf); do
  case "$ns" in
    *:*) nft add element inet egress resolvers6 "{ $ns }" 2>/dev/null || true ;;
    *)   nft add element inet egress resolvers "{ $ns }" 2>/dev/null || true ;;
  esac
done

# Drop root and run the service as the unprivileged `node` user. setpriv keeps
# the env as-is, so set HOME for `node` ourselves - Chromium needs a writable
# home for its crashpad data dir (without it the browser fails to launch).
export HOME=/home/node
exec setpriv --reuid=node --regid=node --init-groups -- "$@"
