# Use the official Rust image.
# Specify a specific version for reproducibility.
FROM rust:1.81 AS builder

# Set the working directory
WORKDIR /usr/src/forum_server

# Install necessary tools first
RUN cargo install cargo-watch sqlx-cli --locked

# Copy the Cargo configuration files from the correct subpath
COPY forum_server/Cargo.toml forum_server/Cargo.lock ./

# Copy the sqlx cache (needs to be generated locally first via `cargo sqlx prepare`)
COPY forum_server/.sqlx ./.sqlx

# Copy the source code from the correct subpath
COPY forum_server/src ./src

# We also need the polycentric-protocol dependency
COPY polycentric-protocol /usr/src/polycentric-protocol

# And the proto definitions it depends on
COPY proto /usr/src/proto

# Build the application in release mode
# Using --locked to ensure Cargo.lock is used
RUN cargo build --release --locked

# --- Runtime Stage ---
# Use a minimal image for the final stage
FROM debian:bullseye-slim

# Set the working directory
WORKDIR /usr/local/bin

# Copy the built binary from the builder stage
COPY --from=builder /usr/src/forum_server/target/release/forum_server .

# Copy static assets used by the server (served under /static/images)
COPY forum_server/static /app/static

# Expose the port the app runs on (update if needed)
EXPOSE 3000

# Command to run the application
CMD ["./forum_server"] 