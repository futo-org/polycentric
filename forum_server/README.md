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
The server will start on `http://127.0.0.1:3000`.

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