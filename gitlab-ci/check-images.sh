#!/bin/bash
set -euo pipefail

NEW_DOCKERFILE_MD5=`cat Dockerfile | md5sum`

echo "EXPECTED MD5: $DOCKERFILE_MD5 -"
echo "ACTUAL   MD5: $NEW_DOCKERFILE_MD5"

if [[ $NEW_DOCKERFILE_MD5 != "$DOCKERFILE_MD5  -" ]]; then
    echo "Dockerfile has been updated. Please ensure that the dev container has been pushed, then update the .gitlab-ci.yml file. You can do this by running ./update-dev-container.sh"
    exit 1
else
    echo "MD5s match. If you are still encountering errors, ensure you pushed the dockerfile with the correct tags!"
fi

echo 

if grep -q "$POSTGRES_IMAGE" docker-compose.development.yml
then 
    echo "Postgres version matches in docker-compose.development.yml"
else 
    echo "Postgres version mismatch in docker-compose.development.yml!"
    exit 1
fi

if grep -q "$POSTGRES_IMAGE" docker-compose.production.yml
then 
    echo "Postgres version matches in docker-compose.production.yml"
else 
    echo "Postgres version mismatch in docker-compose.production.yml!"
    exit 1
fi

if grep -q "$SEARCH_IMAGE" docker-compose.development.yml
then 
    echo "Search version matches in docker-compose.development.yml"
else 
    echo "Search version mismatch in docker-compose.development.yml!"
    exit 1
fi

if grep -q "$SEARCH_IMAGE" docker-compose.production.yml
then 
    echo "Search version matches in docker-compose.production.yml"
else 
    echo "Search version mismatch in docker-compose.production.yml!"
    exit 1
fi

