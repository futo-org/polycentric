# Rootless BuildKit plus the deploy tools. Job steps run as root; the
# service-image action runs buildctl as `user` (rootlesskit refuses root).
FROM moby/buildkit:v0.33.0-rootless
USER root
RUN apk add --no-cache bash curl jq crane cosign helm nodejs
ENTRYPOINT []
