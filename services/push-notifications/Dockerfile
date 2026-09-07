FROM rust:1.97-slim AS chef
WORKDIR /app
COPY services/common/build-deps.sh build-deps.sh
RUN sh build-deps.sh
RUN cargo install cargo-chef --locked

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY packages packages
COPY services services
COPY tools tools
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
COPY protos protos
RUN cargo chef cook --release --recipe-path recipe.json \
    --package push-notifications-service \
    --package push-notifications-migration
COPY Cargo.toml Cargo.lock ./
COPY packages packages
COPY services services
COPY tools tools
# Drop the build tree from this layer so the registry cache only carries the
# binaries; the cook layer above keeps the dependencies.
RUN cargo build --release \
    --package push-notifications-service \
    --package push-notifications-migration \
    && mkdir /out \
    && mv target/release/push-notifications-service target/release/push-notifications-migration /out/ \
    && rm -rf target

FROM rust:1.97-slim
WORKDIR /app
COPY services/common/runtime-deps.sh runtime-deps.sh
RUN sh runtime-deps.sh
COPY --from=builder /out/push-notifications-service /app/push-notifications-service
COPY --from=builder /out/push-notifications-migration /app/push-notifications-migration
CMD ["/app/push-notifications-service"]
