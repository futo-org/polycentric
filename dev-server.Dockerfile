
FROM rust:1.84-slim AS builder
RUN apt-get update && \
    apt-get install -y protobuf-compiler pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

COPY ./proto /proto
COPY ./polycentric-protocol /polycentric-protocol
WORKDIR /polycentric-protocol
RUN cargo build --release

COPY ./server /server
WORKDIR /server
RUN cargo build --release
FROM debian:bookworm-slim AS final

RUN apt-get update && \
    apt-get install -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /server/target/release/server /usr/local/bin/server

ENTRYPOINT ["/usr/local/bin/server"]