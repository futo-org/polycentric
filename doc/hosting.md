---
label: Hosting A Server
icon: server
---

## How to run a Polycentric server

Following these instructions requires `docker`, `docker-compose`, and `git`.

```bash
git clone https://gitlab.futo.org/polycentric/polycentric.git
cd polycentric
mkdir -p state/opensearch/data
sudo chown 1000:1000 -R state/opensearch/data
```

Edit `Caddyfile` replacing `srv1.polycentric.io` with your domain name. Go to your domain registrar and set an `A`, and or `AAAA` record pointing to your server. Caddy will automatically fetch a TLS certificate for your domain when the server starts.

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


