#! /bin/bash


#
#  This is a quick start script to get you up and running with polycentric.
#  It will set up the environment variables and start the docker containers.
#
#  More information can be found  on how to set up your own instance of polycentric 
#  at https://docs.polycentric.io/hosting/
#

# Make a copy of the production yaml that we can make changes to
cp docker-compose.production.yml docker-compose.live.yml

read -p "What type of proxy would you like to use?(caddy,none): " POLYCENTRIC_PROXY_TYPE
if [[ "$POLYCENTRIC_PROXY_TYPE" == "" ]] || [[ "$POLYCENTRIC_PROXY_TYPE" == "caddy" ]]
then
    read -p "Enter the publicly accessable domain name for this server: " POLYCENTRIC_DOMAIN_NAME
    sed -i "s/srv1.polycentric.io/$POLYCENTRIC_DOMAIN_NAME/" ./Caddyfile
else
    sed -i '/proxy:/,$d' docker-compose.live.yml
    sed -i 's!polycentric/polycentric!polycentric/polycentric\n        ports:\n              - "8081:8081"\n              - "80:80"\n              - "443:443"!' docker-compose.live.yml
fi

mkdir -p state/opensearch/data
sudo chown 1000:1000 -R state/opensearch/data

if [ ! -f ".env" ]; then
    echo "No .env file found, generating..."
    touch .env
else
    set -o allexport # enable all variable definitions to be exported
    source <(sed -e "s/\r//" -e '/^#/d;/^\s*$/d' -e "s/'/'\\\''/g" -e "s/=\(.*\)/=\"\1\"/g" ".env")
    set +o allexport
fi

# Generate a postgress password if it's not set
if [[ "$ADMIN_PASSWORD" == "" ]]
then
    read -p "Enter polycentric admin user password: " POLYCENTRIC_ADMIN_PASS
    if [[ "$POLYCENTRIC_ADMIN_PASS" == "" ]]
    then
        export POLYCENTRIC_ADMIN_PASS="$(openssl rand -base64 22 | tr -- '+/=' '-_-' | tr -d '\n')-1"
    fi
    sed -i "/ADMIN_PASSWORD=.*/d" .env
    echo "ADMIN_PASSWORD=$POLYCENTRIC_ADMIN_PASS" >> .env
else
    export POLYCENTRIC_ADMIN_PASS=$ADMIN_PASSWORD
fi

# Generate a postgress password if it's not set
if [[ "$POSTGRES_PASSWORD" == "" ]]
then
    read -p "Enter polycentric postgres user password for postgres database: " POLYCENTRIC_POSTGRES_PASS
    if [[ "$POLYCENTRIC_POSTGRES_PASS" == "" ]]
    then
        export POLYCENTRIC_POSTGRES_PASS="$(openssl rand -base64 22 | tr -- '+/=' '-_-' | tr -d '\n')-2"
    fi
    sed -i "/POSTGRES_PASSWORD=.*/d" .env
    echo "POSTGRES_PASSWORD=$POLYCENTRIC_POSTGRES_PASS" >> .env
else
    export POLYCENTRIC_POSTGRES_PASS=$POSTGRES_PASSWORD
fi

# Generate an admin token
if [[ "$ADMIN_TOKEN" == "" ]]
then
    export ADMIN_TOKEN_GENERATED="$(openssl rand -base64 30 | tr -- '+/=' '-_-' | tr -d '\n')-3"
    echo "ADMIN_TOKEN=$ADMIN_TOKEN_GENERATED" >> .env
else
   export ADMIN_TOKEN_GENERATED="$ADMIN_TOKEN"
fi

# Generate an challenge key
if [[ "$CHALLENGE_KEY" == "" ]]
then
    export CHALLENGE_KEY_GENERATED="$(openssl rand -base64 30 | tr -- '+/=' '-_-' | tr -d '\n')-3"
    echo "CHALLENGE_KEY=$CHALLENGE_KEY_GENERATED" >> .env
else
   export CHALLENGE_KEY_GENERATED="$CHALLENGE_KEY"
fi


# Select moderation mode
if [[ "$MODERATION_MODE" == "" ]]
then
    read -p "Please select moderation mode (OFF/LAZY/STRONG): " MODERATION_MODE_SELECT
    if [[ "$MODERATION_MODE_SELECT" == "" ]]
    then
        export MODERATION_MODE_SELECT="LAZY"
    else
       if [[ "$MODERATION_MODE_SELECT" == "OFF" ]] || [[ "$MODERATION_MODE_SELECT" == "LAZY" ]] || [[ "$MODERATION_MODE_SELECT" == "STRONG" ]]
       then
            echo "Setting moderation mode to $MODERATION_MODE_SELECT"
       else
            echo "Invalid moderation mode selected, defaulting to LAZY"
            export MODERATION_MODE_SELECT="LAZY"
       fi
    fi
    sed -i "/MODERATION_MODE=.*/d" .env
    echo "MODERATION_MODE=$MODERATION_MODE_SELECT" >> .env
fi

# Select moderation provider
if [[ "$TAG_INTERFACE" == "" ]]
then
    read -p "Please select moderation provider (none/azure): " MODERATION_PROVIDER_SELECT
    if [[ "$MODERATION_PROVIDER_SELECT" == "" ]]
    then
        export MODERATION_PROVIDER_SELECT="none"
    fi
    sed -i "/TAG_INTERFACE=.*/d" .env
    echo "TAG_INTERFACE=$MODERATION_PROVIDER_SELECT" >> .env
    export TAG_INTERFACE=$MODERATION_PROVIDER_SELECT
fi

# Set up azure tagging if selected
if [[ "$TAG_INTERFACE" == "azure" ]]
then
    if [[ "$AZURE_TAGGING_ENDPOINT" == "" ]] || [[ "$AZURE_TAGGING_SUBSCRIPTION_KEY" == "" ]] || [[ "$AZURE_TAGGING_API_VERSION" == "" ]]
    then 
        echo "If using azure TAG_INTERFACE, You must set AZURE_TAGGING_ENDPOINT, AZURE_TAGGING_SUBSCRIPTION_KEY, and AZURE_TAGGING_API_VERSION in the .env file"
        echo "https://docs.polycentric.io/hosting/"
        exit 1
    fi
fi




sed -i "s/POSTGRES_STRING=.*//" .env
export POSTGRES_STRING="postgres://postgres:$POLYCENTRIC_POSTGRES_PASS@postgres"
echo "POSTGRES_STRING=postgres://postgres:$POLYCENTRIC_POSTGRES_PASS@postgres" >> .env

# Set up the postgres password in the docker compose file
sed -i "s/POSTGRES_PASSWORD: testing/POSTGRES_PASSWORD: $POLYCENTRIC_POSTGRES_PASS/g" docker-compose.live.yml
sed -i '/CHALLENGE_KEY=/d' docker-compose.live.yml
sed -i 's!        read_only: true!        read_only: true\n        env_file: ".env"!' docker-compose.live.yml
sed -i '/ADMIN_TOKEN=123/d' docker-compose.live.yml
#sed -i 's!"'"ADMIN_TOKEN=123"'"!ADMIN_TOKEN='"$ADMIN_TOKEN_GENERATED\n            - CHALLENGE_KEY=$CHALLENGE_KEY_GENERATED!" docker-compose.live.yml

#docker compose up -d docker-compose.livedev.yml down
docker compose -f docker-compose.live.yml down
docker compose -f docker-compose.live.yml pull
docker compose -f docker-compose.live.yml up --watch
