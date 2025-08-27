FROM rust:1.75 AS builder

WORKDIR /app

# Copy Cargo files first for better caching
COPY Cargo.toml Cargo.lock ./
COPY ../polycentric-protocol /polycentric-protocol

# Copy source code
COPY src ./src
COPY build.rs ./
COPY migrations ./migrations

# Build the application
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from builder stage
COPY --from=builder /app/target/release/dm-server .
COPY --from=builder /app/migrations ./migrations

EXPOSE 8080 8081

CMD ["./dm-server"]
