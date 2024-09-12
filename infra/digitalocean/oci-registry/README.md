# Digital Ocean Container Registry

## Regional Resource

Please don't use a personal access token, let kaniko do the work in a reproducable and perfect way everytime unless there's an emergency

NOTE: match region with cluster, cluster needs access policies ( at least in aws? ) to pull containers

``` snippet.tf
resource "digitalocean_container_registry" "foobar" {
  name                   = "foobar"
  subscription_tier_slug = "starter"
}

resource "digitalocean_container_registry_docker_credentials" "foobar-creds" {
  registry_name = "foobar"
}
```

### Use

put these in gitlab secrets for kaniko auth with and write containers and helm charts to the digital oceans OCI registry

``` snippet.tf
url = data.digitalocean_container_registry.foobar.server_url
creds= digitalocean_container_registry_docker_credentials.foobar-creds.docker_credentials
```

### Write to container registry from Kaniko in GitLab CI

[Guide](https://www.portainer.io/blog/how-to-use-the-digitalocean-container-registry-within-portainer)

``` sh
echo "{\"auths\":{\"$CONTAINER_REGISTRY\":{\"username\":\"doadmin\",\"password\":\"$CREDENTIALSFROMABOVE\"}}}" > /kaniko/.docker/config.json
/kaniko/executor --context ./ --dockerfile Dockerfile --destination URLFROMABOVE/CONTAINERNAME:$CONTAINERTAG
```

something like this for helm


``` sh
helm pull oci://source-registry.com/mychart --version 0.1.0 --untar # need lsit of helm charts to pull, can do rolling updates if well architected...
# 3. Authenticate to DigitalOcean's OCI registry
echo $DIGITALOCEAN_ACCESS_TOKEN | helm registry login registry.digitalocean.com -u doadmin --password-stdin
# 4. Tag the chart for the new registry
helm chart save ./mychart registry.digitalocean.com/my-registry/mychart:0.1.0
# 5. Push the chart to DigitalOcean's OCI registry
helm chart push registry.digitalocean.com/my-registry/mychart:0.1.0
# 6. Verify the push
helm registry list
```

``` sh
helm pull <source-repo>/<chart-name> --version <version> --untar

helm chart save ./mychart registry.digitalocean.com/your-registry-name/mychart:0.1.0

/kaniko/executor \
  --context ./ \
  --dockerfile /dev/null \
  --destination registry.digitalocean.com/your-registry-name/helm-charts/mychart:0.1.0 \
  --tarPath ./mychart-0.1.0.tgz
```