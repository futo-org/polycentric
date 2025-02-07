FROM ubuntu:22.04

ENV PATH="${PATH}:/opt/protobuf-codegen/bin"
ENV PATH="${PATH}:/opt/rust/toolchains/stable-x86_64-unknown-linux-gnu/bin"
ENV PATH="${PATH}:/opt/sccache"

RUN apt-get update -y && \
	apt-get install -y ca-certificates curl gnupg && \
	mkdir -p /etc/apt/keyrings && \
	curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
	echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
	apt-get update -y && \
	apt-get install -y \
		make \
		libicu70 \
		protobuf-compiler \
		nodejs \
		bash \
		build-essential \
		git \
		pkg-config \
		openssl \
		libssl-dev \
		net-tools \
		gdbserver \
		gdb \
		mkcert && \
	export RUSTUP_HOME=/opt/rust && \
	curl https://sh.rustup.rs -sSf | sh -s -- -y && \
	cargo install protobuf-codegen@3.1.0 --root /opt/protobuf-codegen && \
	curl --location --remote-header-name --output sccache.tar.gz https://github.com/mozilla/sccache/releases/download/v0.5.0/sccache-v0.5.0-x86_64-unknown-linux-musl.tar.gz && \
	mkdir /opt/sccache && \
	tar -xzf sccache.tar.gz -C /opt/sccache && \
	mv /opt/sccache/sccache*/sccache /opt/sccache/sccache && \
	npm install --global \
		wrangler \
		prettier \
		eslint


