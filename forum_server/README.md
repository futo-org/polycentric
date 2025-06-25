# Polycentric Forum Server

A Rust-based server for the Polycentric forum feature.

## Prerequisites

1.  **Rust:** Install Rust and Cargo (https://www.rust-lang.org/tools/install).
2.  **PostgreSQL:** Install PostgreSQL (version 12+ recommended).
    *   Make sure the PostgreSQL server is running.
    *   You need a database and a user role that the forum server can use.
3.  **sqlx-cli:** Install the SQLx command-line tool:
    ```bash
    cargo install sqlx-cli --no-default-features --features rustls,postgres
    ```
4.  **dotenv CLI (Optional but recommended):** Install the dotenv CLI helper:
    ```bash
    cargo install dotenv --features cli
    ```

## Setup

1.  **Clone the repository** (if applicable)
2.  **Configure Environment:**
    *   Copy the example environment file: `cp .env.example .env`
    *   Edit the `.env` file and set the `DATABASE_URL` to point to your running PostgreSQL instance. Use the format: `postgres://<user>:<password>@<host>:<port>/<database_name>`.
3.  **Database Migrations:**
    *   Make sure your PostgreSQL server is running and accessible.
    *   Run the database setup command (this will attempt to create the database if it doesn't exist and run migrations):
        ```bash
        # Using dotenv CLI (recommended)
        dotenv -f .env -- sqlx database setup

        # Or using --database-url flag
        # sqlx database setup --database-url "$(grep DATABASE_URL .env | cut -d '=' -f2-)"

        # Or by exporting the variable first
        # export DATABASE_URL="$(grep DATABASE_URL .env | cut -d '=' -f2-)"
        # sqlx database setup
        ```
    *   If the database already exists and you only want to run migrations:
        ```bash
        dotenv -f .env -- sqlx migrate run
        ```

## Building

```bash
cargo build
```

## Running

Make sure your PostgreSQL server is running.
```bash
cargo run
```
The server will start on `http://127.0.0.1:3000` but you need to add `https://localhost:8080` to your forum server list due to caddy.
Navigate to `https://localhost:8080` in the same browser to accept the certs to allow connection on the front end.

## Testing
```
dotenv -f .env -- cargo test -- --test-threads=1 --nocapture
```

## SQL debugging
```
DATABASE_URL='URL' sqlx database drop
DATABASE_URL='URL' sqlx database create
DATABASE_URL='URL' sqlx migrate run
DATABASE_URL='URL' cargo sqlx prepare
```

## Docker

Build the image:
```bash
docker build -t polycentric-forum-server .
```

Run the container (make sure to pass the database URL as an environment variable):
```bash
docker run -p 3000:3000 -e DATABASE_URL="your_postgres_db_url" polycentric-forum-server
```

## Production Deployment

Below is a **minimal but complete** guide for running the forum server in a real-world (production) environment.  The goal is that you can copy-and-paste the snippets and be online in minutes.

### 1. Decide how you will run the server

| Option | When to choose it |
| ------ | ----------------- |
| **Docker / Docker Compose** (recommended) | You are already using containers or want an easy upgrade path. |
| **Native binary + systemd** | You want zero Docker on the host or maximal performance. |

Both options are covered below – pick the one that best fits your stack.

---

### 2. Common prerequisites

1. **Domain name + TLS certificate** – the examples assume `forum.example.com` with a public certificate.
2. **PostgreSQL 12+** – provision a database and note the connection URL (e.g. `postgres://forum:strongpass@db:5432/forum`).
3. **Admin public keys** – Polycentric uses Ed25519 public keys to authorise moderator actions. Create/collect the base64-encoded keys for your admins and list them comma-separated in `ADMIN_PUBKEYS` (see below).
4. **Image uploads directory** – pick a host path with enough disk (e.g. `/var/lib/polycentric-forum/uploads`).

Environment variables used by the server:

```env
DATABASE_URL=postgres://forum:strongpass@db:5432/forum
IMAGE_UPLOAD_DIR=/data/uploads                        # path _inside the container_ (or host path for native)
IMAGE_BASE_URL=https://forum.example.com/uploads/images
ADMIN_PUBKEYS=base64pubkey1,base64pubkey2             # comma-separated, **no spaces**
FORUM_SERVER_NAME=My Awesome Forum                    # shown to clients
FORUM_SERVER_IMAGE_URL=https://forum.example.com/logo.png (optional)
```

Save the variables in an `.env.production` file – *do **not** commit this to git*.

---

## Option A – Docker / Docker Compose (recommended)

Create a file `docker-compose.yml` next to your `.env.production`:

```yaml
version: "3.8"

services:
  forum-db:
    image: postgres:15
    restart: unless-stopped
    environment:
      POSTGRES_USER: forum
      POSTGRES_PASSWORD: strongpass
      POSTGRES_DB: forum
    volumes:
      - ./data/db:/var/lib/postgresql/data

  forum-server:
    # Use the pre-built image *or* build locally with the Dockerfile in this repo.
    image: polycentric/forum-server:latest
    # build: .               # uncomment to build locally
    depends_on:
      - forum-db
    env_file:
      - ./.env.production
    volumes:
      - ./data/uploads:/data/uploads              # maps to IMAGE_UPLOAD_DIR
    ports:
      - "3000:3000"                               # internal port, will be proxied by Caddy/Nginx
    restart: unless-stopped
```

Bring the stack online:

```bash
docker compose up -d
```

### Initialise the database inside the running container

```bash
docker compose exec forum-server \
  sqlx database setup --database-url "$DATABASE_URL"
```

Afterwards, the API will be available on port `3000` (*plain HTTP*).  In real production you will normally place a reverse proxy in front – see below.

---

###  Reverse proxy with automatic TLS (Caddy example)

[Caddy](https://caddyserver.com) provides fully-automated HTTPS with Let's Encrypt.  Create `Caddyfile` (outside of Compose):

```Caddyfile
forum.example.com {
    reverse_proxy localhost:3000
    encode zstd gzip
    file_server                                     # optional: serve static files
}
```

Run Caddy as a systemd service or a container – it will request a certificate and proxy traffic to the forum server.

---

## Option B – Native binary managed by systemd

1. Compile the release build on the target machine (requires Rust) **or** cross-compile and copy the binary:

```bash
cargo build --release --locked
sudo install -m755 target/release/forum_server /usr/local/bin/forum_server
```

2. Create the upload directory and assign permissions (replace `polyforum` with the user you prefer):

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin polyforum
sudo mkdir -p /var/lib/polycentric-forum/uploads
sudo chown -R polyforum:polyforum /var/lib/polycentric-forum
```

3. Write the file `/etc/forum-server.env` containing the **same** variables shown earlier and restrict access:

```bash
sudo chmod 600 /etc/forum-server.env
```

4. Add the systemd unit `/etc/systemd/system/forum-server.service`:

```ini
[Unit]
Description=Polycentric Forum Server
After=network.target

[Service]
Type=simple
User=polyforum
EnvironmentFile=/etc/forum-server.env
ExecStart=/usr/local/bin/forum_server
WorkingDirectory=/var/lib/polycentric-forum
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

5. Start and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now forum-server
```

Combine this with Caddy/Nginx as described above to provide HTTPS.

---

### Keeping the server up-to-date

* **Docker:** pull the latest image and run `docker compose up -d`.
* **Native:** rebuild (`cargo build --release --locked`) and restart `systemctl restart forum-server`.

---

### Testing your deployment

1. Visit `https://forum.example.com/info` (or the route you expose) – you should receive a JSON blob with your server's name.
2. Upload an image (via the Polycentric UI) and confirm it appears under `IMAGE_BASE_URL`.
3. Use the Polycentric client to add the new forum server to your list and verify posts/threads load.

Congratulations – your self-hosted forum is live!

> **Need help?**  Open an issue or join the Polycentric community chat. 