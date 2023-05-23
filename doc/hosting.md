---
label: Hosting A Server
icon: server
---

## Quick start: How to run a Polycentric server

Following these instructions requires `docker`, `docker-compose`, and `git`.

```bash
git clone https://gitlab.futo.org/polycentric/polycentric.git
cd polycentric
mkdir -p state/opensearch/data
sudo chown 1000:1000 -R state/opensearch/data
```

### Basic Configuration

Edit `Caddyfile` replacing `srv1.polycentric.io` with your domain name. Go to your domain registrar and set an `A`, and or `AAAA` record pointing to your server. Caddy will automatically fetch a TLS certificate for your domain when the server starts.

Edit `docker-compose.production.yml` replacing the value of `ADMIN_TOKEN` with a strong passphrase.

Edit `docker-compose.production.yml` replacing the value of `${DOCKER_GID}` with the group id of the `docker` group on your system (or any group that has permission
to access the docker socket). You can find this id by running `stat -c '%g' /var/run/docker.sock`.

### Start the server

```bash
docker-compose -f docker-compose.production.yml up -d
```

You are now done. Add your new server to your profile using the Polycentric client and start using it. Upgrading the server is very simple:

```bash
# stop the existing server
docker-compose -f docker-compose.production.yml down
# download updates
docker-compose -f docker-compose.production.yml pull
# start the server up again
docker-compose -f docker-compose.production.yml up -d
```

## Advanced server management

A Polycentric server depends on `PostgreSQL`, and `OpenSearch`. Configuration is controlled with environment variables. A proxy such as `NGINX`, or `Caddy` is required to provide TLS. Manual configuration is required if you wish to run a distributed server, such as storage being run on other nodes. The Polycentric server may be horizontally scaled across multiple nodes with shared external storage.

```bash
# An unsigned 16 bit number representing the port that should be bound.
export HTTP_PORT_API='80'
# The PostgreSQL connection string
export POSTGRES_STRING='postgres://postgres:testing@postgres'
# The OpenSearch connection string
export OPENSEARCH_STRING='http://opensearch:9200'
# The token required for administrative tasks
export ADMIN_TOKEN='something_long_and_random'
```

## Moderation API

Server operators may choose to censor content on their own node. There are two types of censorship available. The first `DO_NOT_RECOMMEND` means that content will not be returned in server curated data. Examples of this include the explore page, and recommended profiles. The second is `DO_NOT_STORE` where the server will outright refuse to host data.

A specific post, or entire profile may be censored. The API accepts a particular link to censor. If you want to censor a post, provide a link to a post, if you want to censor a profile, provide a link to a profile.

Example API usage with curl:

```bash
curl \
    -X POST \
    -H 'Authorization: abc123' \
    https://my-server.com/censor?censorship_type=DO_NOT_RECOMMEND \
    -d 'https://polycentric.io/feed/a/CiA_zaEPAlQ2H7hmNbT'
```

## Monitoring & Dashboards

Polycentric comes equipped with monitoring to let server operators monitor the health and overall metrics of their node. By default, you can find a grafana
dashboard at `localhost:8090`. The default login is `username: admin` `password: admin`, we recommend changing this upon first sign in. If you wish to
edit the grafana dashboard, you should modify the json file located at `monitoring/grafana-dashboards/main-dashboard.json`.
