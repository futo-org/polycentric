FROM rust:1.82 AS builder

WORKDIR /usr/src/dm_server

# Install required dependencies for development
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install cargo-watch for development
RUN cargo install cargo-watch --version=8.5.3

# Install sqlx-cli for database migrations
RUN cargo install sqlx-cli --no-default-features --features postgres

# Copy polycentric-protocol dependency
COPY polycentric-protocol /usr/src/polycentric-protocol
COPY proto /usr/src/proto

# Copy DM server Cargo files first for better caching
COPY dm_server/Cargo.toml dm_server/Cargo.lock ./

# Copy DM server source code
COPY dm_server/src ./src
COPY dm_server/build.rs ./
COPY dm_server/migrations ./migrations

# Build the application for production
RUN cargo build --release

# For development, we'll override the command in docker-compose
CMD ["tail", "-f", "/dev/null"]

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from builder stage
COPY --from=builder /usr/src/dm_server/target/release/dm-server ./dm-server
COPY --from=builder /usr/src/dm_server/migrations ./migrations

EXPOSE 8080 8081

CMD ["./dm-server"]
