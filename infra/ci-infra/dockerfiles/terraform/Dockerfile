FROM hashicorp/terraform:1.9.5
LABEL LICENSE="MPL 2.0, custom terms"
LABEL LICENSE_URL="https://github.com/hashicorp/terraform/blob/main/LICENSE"

RUN apk add --no-cache bash curl helm kubectl

RUN curl -sL https://github.com/digitalocean/doctl/releases/download/v1.113.0/doctl-1.113.0-linux-amd64.tar.gz | tar -xzv \
    && mv doctl /usr/local/bin/
    
LABEL LICENSE="Apache License 2.0"
LABEL LICENSE_URL="https://github.com/digitalocean/doctl/blob/main/LICENSE.txt"

ENTRYPOINT ["/bin/bash","-c"]