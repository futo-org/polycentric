.PHONY: proto pretty clean sandbox build-sandbox join-sandbox stop-sandbox join-postgres devcert deploy-polycentric-spa-staging build-ci-deps deploy-charts push-server-image

CURRENT_UID := $(shell id -u)
CURRENT_GID := $(shell id -g)
UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
	DOCKER_GID := $(shell stat -f '%g' /var/run/docker.sock 2> /dev/null)
else
	DOCKER_GID := $(shell stat -c '%g' /var/run/docker.sock 2> /dev/null)
endif

export CURRENT_UID
export CURRENT_GID
export DOCKER_GID

build-sandbox:
	docker compose -f docker-compose.development.yml pull
	docker compose -f docker-compose.development.yml build

start-sandbox:
ifndef DOCKER_GID
	$(error It seems that no groups on your system have permisison to use docker (do you have docker installed?))
endif
	docker compose -f docker-compose.development.yml up -d

stop-sandbox:
ifndef DOCKER_GID
	$(error It seems that no groups on your system have permisison to use docker (do you have docker installed?))
endif
	docker compose -f docker-compose.development.yml down
	docker compose -f docker-compose.development.yml rm

join-sandbox:
	docker compose -f docker-compose.development.yml \
		exec development /bin/bash --rcfile /app/.docker-bashrc

join-postgres:
	docker compose -f docker-compose.development.yml \
		exec postgres psql -U postgres 

start-gdbserver:
	docker compose -f docker-compose.development.yml \
		exec development gdbserver 0.0.0.0:3345 ./server/target/debug/server

devcert:
	mkdir -p ./devcert/
	mkcert -cert-file ./devcert/local-cert.pem -key-file ./devcert/local-key.pem localhost 127.0.0.1 ::1 $$(ifconfig | grep -oE "\binet\b [0-9.]+ " | grep -oE "[0-9.]+")

proto: proto/protocol.proto
	npm install
	protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true \
		--ts_proto_opt=forceLong=long \
		--ts_proto_out=. \
		--experimental_allow_proto3_optional \
		proto/protocol.proto
	cp proto/protocol.ts packages/polycentric-core/src/protocol.ts

pretty:
	npx prettier@3.1.1 --write \
		packages/polycentric-core/src/ \
		packages/polycentric-react/src/ \
		packages/polycentric-web/src/ \
		packages/harbor-web/src/ \
		packages/polycentric-desktop/src/ \
		packages/polycentric-bot/src/ \
		packages/polycentric-desktop/src/ \
		packages/polycentric-desktop/electron/ \
		packages/test-data-generator/src/

build-production: proto
	./version.sh

# NPM automatically installs and resolves (co)dependencies for all packages 
	npm install

	cd packages/polycentric-core && \
		npm run build

	cd packages/polycentric-react && \
		npm run build

	cd packages/polycentric-web && \
		npm run build

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
		packages/*/node_modules \
		packages/*/dist \
		packages/polycentric-web/build \
		packages/polycentric-web-legacy/build \
		server/target

deploy-polycentric-web-production:
	wrangler pages deploy --project-name polycentric-spa-production \
		./packages/polycentric-web/dist/ --branch master

deploy-polycentric-web-staging:
	wrangler pages deploy --project-name polycentric-spa-staging \
		./packages/polycentric-web/dist/ --branch master

deploy-harbor-spa:
	wrangler pages deploy --project-name harbor-social \
		./packages/harbor-web/dist/ --branch main

build-ci-deps:
	DOCKER_BUILDKIT=1 docker build \
        -f infra/ci-infra/dockerfiles/terraform/Dockerfile \
		-t gitlab.futo.org:5050/polycentric/polycentric/terraform:latest .
	docker push gitlab.futo.org:5050/polycentric/polycentric/terraform:latest
	DOCKER_BUILDKIT=1 docker build \
        -f infra/ci-infra/dockerfiles/kaniko/Dockerfile \
		-t gitlab.futo.org:5050/polycentric/polycentric/kaniko:latest .
	docker push gitlab.futo.org:5050/polycentric/polycentric/kaniko:latest

push-server-image-do:
	DOCKER_BUILDKIT=1 docker build \
		-f server.dockerfile \
		-t registry.digitalocean.com/polycentric/polycentric:latest .
	docker push registry.digitalocean.com/polycentric/polycentric:latest
