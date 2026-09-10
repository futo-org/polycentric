FROM rust:slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    unzip \
    zstd \
    pkg-config \
    libssl-dev \
    libsasl2-dev \
    cmake \
    make \
    g++ \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Rust deps
RUN rustup component add clippy rustfmt && rustup target add wasm32-unknown-unknown
RUN cargo install just && rm -rf /usr/local/cargo/registry

# sccache
RUN curl -L "https://github.com/mozilla/sccache/releases/download/v0.10.0/sccache-v0.10.0-x86_64-unknown-linux-musl.tar.gz" \
    | tar xz --strip-components=1 -C /usr/local/bin --wildcards "*/sccache" \
    && chmod +x /usr/local/bin/sccache

# cargo-nextest
RUN curl -L "https://get.nexte.st/0.9.140/linux" \
    | tar xz -C /usr/local/bin

# Nodejs
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# PNPM
RUN npm install -g pnpm@10.19.0
