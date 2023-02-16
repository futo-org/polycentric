FROM ubuntu:22.04

ENV PATH="${PATH}:/opt/protobuf-codegen/bin"
ENV PATH="${PATH}:/opt/rust/toolchains/stable-x86_64-unknown-linux-gnu/bin"

RUN apt-get update -y && \
	apt-get install -y curl && \
	curl -sL https://deb.nodesource.com/setup_16.x  | bash && \
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
		libssl-dev && \
	export RUSTUP_HOME=/opt/rust && \
	curl https://sh.rustup.rs -sSf | sh -s -- -y && \
	cargo install protobuf-codegen@3.1.0 --root /opt/protobuf-codegen && \
	npm install --global \
		retypeapp \
		wrangler

