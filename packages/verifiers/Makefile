.PHONY: start stop

USER_ID := $(shell id -u)
GROUP_ID := $(shell id -g)

export USER_ID
export GROUP_ID

start:
	mkdir -p ./state
	docker compose up

stop:
	docker compose down


