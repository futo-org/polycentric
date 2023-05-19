.PHONY: proto pretty clean sandbox build-sandbox join-sandbox stop-sandbox

CURRENT_UID := $(shell id -u)
CURRENT_GID := $(shell id -g)
DOCKER_GID := $(shell stat -c '%g' /var/run/docker.sock)

export CURRENT_UID
export CURRENT_GID
export DOCKER_GID

ifndef DOCKER_GID
$(error It seems that no groups on your system have permisison to use docker (do you have docker installed?))
endif


build-sandbox:
	docker-compose -f docker-compose.development.yml pull
	docker-compose -f docker-compose.development.yml build

start-sandbox:
	docker-compose -f docker-compose.development.yml up -d

stop-sandbox:
	docker-compose -f docker-compose.development.yml down
	docker-compose -f docker-compose.development.yml rm

join-sandbox:
	docker-compose -f docker-compose.development.yml \
		exec development /bin/bash

proto: proto/protocol.proto
	npm install
	npx protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true \
		--ts_proto_opt=forceLong=long \
		--ts_proto_out=. \
		--experimental_allow_proto3_optional \
		proto/protocol.proto
	cp proto/protocol.ts packages/polycentric-core/src/protocol.ts

pretty:
	npx prettier --write \
		packages/polycentric-core/src/ \
		packages/polycentric-react/src/ \
		packages/polycentric-web/src/ \
		packages/polycentric-desktop/src/ \
		packages/polycentric-desktop/electron/ \
		packages/polycentric-bot/src/

build-production: proto
	./version.sh

# NPM automatically installs and resolves (co)dependencies for all packages 
	npm install

	cd packages/polycentric-core && \
		npm run build:production

	cd packages/polycentric-react && \
		npm run build:production

	cd packages/polycentric-web && \
		npm run build:production

	cd server && \
		cargo build

build-server-image:
	DOCKER_BUILDKIT=1 docker build \
		-f server.dockerfile \
		-t gitlab.futo.org:5050/polycentric/polycentric:stg .

push-server-image:
	docker push gitlab.futo.org:5050/polycentric/polycentric:stg

clean:
	rm -rf \
		node_modules \
		packages/polycentric-core/src/protocol.ts \
		server/src/protocol.rs \
		packages/polycentric-core/node_modules \
		packages/polycentric-core/dist \
		packages/polycentric-react/node_modules \
		packages/polycentric-react/dist \
		packages/polycentric-web/node_modules \
		packages/polycentric-web/build \
		packages/polycentric-desktop/node_modules \
		packages/polycentric-desktop/build \
		packages/polycentric-desktop/dist \
		packages/polycentric-leveldb/dist \
		packages/harbor-web/node_modules \
		packages/harbor-web/dist \
		server/target

build-doc-site:
	cd doc && retype build

deploy-doc-site:
	wrangler pages publish --project-name polycentric-docs \
		./doc/.retype/

deploy-spa:
	wrangler pages publish --project-name polycentric-spa \
		./packages/polycentric-web/dist/
