# An introduction to Polycentric

Polycentric is an Open-source distributed social network. Checkout our documentation [here](https://docs.polycentric.io), or tryout the app [here](https://polycentric.io).

## Project layout

Polycentric is split into a variety of Typescript packages, and a Rust backend. Aspects like persistence are abstracted away allowing browsers to use `IndexedDB` while desktop or bots use `LevelDB`.

- Browser client `./packages/polycentric-web` which depends on `polycentric-react`
- Desktop client `./packages/polycentric-desktop` which depends on `polycentric-react`
- React UI `./packages/polycentric-react` which depends on `polycentric-core`
- Bot client `./packages/polycentric-bot` which depends on `polycentric-core`
- Core logic `./packages/polycentric-core`
- Server implementation `./server`

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
