# Use the official Rust image.
# Specify a specific version for reproducibility.
FROM rust:1.78 AS builder

# Set the working directory
WORKDIR /usr/src/forum_server

# Copy the Cargo configuration files
COPY Cargo.toml Cargo.lock ./

# Copy the source code
COPY src ./src

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

# Expose the port the app runs on (update if needed)
EXPOSE 3000

# Command to run the application
CMD ["./forum_server"] 