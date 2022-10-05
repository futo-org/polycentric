.PHONY: proto pretty clean sandbox build-sandbox join-sandbox stop-sandbox

CURRENT_UID := $(shell id -u)
CURRENT_GID := $(shell id -g)

export CURRENT_UID
export CURRENT_GID

build-sandbox:
	docker-compose pull
	docker-compose build

start-sandbox:
	docker-compose up -d

stop-sandbox:
	docker-compose down
	docker-compose rm

join-sandbox:
	docker-compose exec development /bin/bash

proto: proto/user.proto
	npm install
	protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true \
		--ts_proto_out=. \
		--rust_out=server/src/ \
		--experimental_allow_proto3_optional \
		proto/user.proto
	cp proto/user.ts packages/polycentric-core/src/user.ts

pretty:
	npx prettier --write \
		packages/polycentric-core/src/ \
		packages/polycentric-react/src/ \
		packages/polycentric-web/src/ \
		packages/polycentric-desktop/src/ \
		packages/polycentric-desktop/electron/ \
		packages/polycentric-bot/src/

link:
	mkdir -p \
		packages/polycentric-react/node_modules \
		packages/polycentric-bot/node_modules \
		packages/polycentric-web/node_modules \
		packages/polycentric-desktop/node_modules

	ln -sn \
		packages/polycentric-core \
		packages/polycentric-react/node_modules/polycentric-core

	ln -sn \
		packages/polycentric-core \
		packages/polycentric-bot/node_modules/polycentric-core

	ln -sn \
		packages/polycentric-react \
		packages/polycentric-web/node_modules/polycentric-react

	ln -sn \
		packages/polycentric-react \
		packages/polycentric-desktop/node_modules/polycentric-react

build-production: proto
	cd packages/polycentric-core && \
		npm install && \
		npm run build:production

	cd packages/polycentric-react && \
		npm install && \
		npm run build:production

	cd packages/polycentric-web && \
		npm install && \
		npm run build:production

	cd server && \
		cargo build

clean:
	rm -rf \
		node_modules \
		packages/polycentric-core/src/user.ts \
		server/src/user.rs \
		packages/polycentric-core/node_modules \
		packages/polycentric-core/dist \
		packages/polycentric-react/node_modules \
		packages/polycentric-react/dist \
		packages/polycentric-web/node_modules \
		packages/polycentric-web/build \
		packages/polycentric-desktop/node_modules \
		packages/polycentric-desktop/build \
		packages/polycentric-desktop/dist \
		server/target
