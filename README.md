# Polycentric

Polycentric is a distributed Open-source Social Network with
cryptographic sovereign identities. Content lives on multiple
servers chosen by the identity owner.

Your client will automatically download content from the servers
it lives on. Data is cryptographically integrity checked to
ensure servers are not modifying, or hiding messages from users.
Data is offline first, allowing offline browsing, and offline
posting.

## Development quickstart

Development requires `docker`, and `docker-compose`.

```bash
# open a shell
# setup the Docker development sandbox
make build-sandbox
# start the Docker development sandbox
make start-sandbox
# join the sandbox with your current shell
make join-sandbox

# create a production build of each package
make build-production
# start the web ui
cd packages/polycentric-web
npm run start

# open another shell
# join the existing sandbox with your new shell
make join-sandbox
# start the backend
cd server
cargo run

# Connect to the web UI at https://localhost:8081

# When done destroy the sandbox environment
make stop-sandbox
```
