---
label: Hosting
icon: server
order: 8
---

# Hosting

Verifiers are built to be self-hosted by anyone in any infrastructure configuration. This page will provide instructions on
how to host your own verifiers server both with and without Docker.

## With Docker Compose

Paste the following file into a `docker-compose.yml` file:

```yaml
version: '2'
  services: 
    verifiers:
      image: gitlab.futo.org:5050/videostreaming/verifiers:latest
      restart: unless-stopped 
      user: "${USER_ID}:${GROUP_ID}"
      volumes:
        - verifier-state:/usr/src/app/state
  volumes:
    verifier-state
```

This file creates a service called `verifiers` which uses the latest docker image for Harbor Verifiers, and creates a
volume to store the verifier's persistent state. 

You can then start the verifiers server by running the below commands

Docker Compose v3:
```shell
docker compose up -d
```

Docker Compose v1 & v2:
```shell
docker-compose up -d
```

## Without Docker

Follow the instructions in [Getting Started](getting-started) in order to download the files needed to run the verifiers  onto
your machine.

Once you have followed these instructions, you can run the following command to start the server:

```shell
npm run start
```

## Configuration

### Configuring Verifiers

Some verifiers may require additional configuration in the form of environment variables. You will need to add this configuration
using the below instructions for them to function properly

*Note that each verifier likely will have slightly different requirements for setup, you should refer to their 
documentation for specific configuration information. The documentation for verifiers that are installed by default
are at [Preinstalled Verifiers](preinstalled-verifiers)*

#### With Docker Compose

In order to add these, you 
will need to add an `environment` section to your `docker-compose.yml` file.  For example, when setting up the Discord 
verifier, your configuration would look like:

```yaml #7-11
version: '2'
  services: 
    verifiers:
      image: gitlab.futo.org:5050/videostreaming/verifiers:latest
      restart: unless-stopped 
      user: "${USER_ID}:${GROUP_ID}"
      environment:
        DISCORD_OAUTH_URL: "https://discord.com/api/oauth2/authorize?client_id=XXXXXXXXXXXXXXX&redirect_uri=XXXXXXXXXXXXXXX&response_type=code&scope=identify
        DISCORD_REDIRECT_URL: https://your.verifier.com/platforms/discord/oauth/callback
        DISCORD_CLIENT_SECRET: XXXXXXXXXXXXXXXXXXXX 
        DISCORD_CLIENT_ID: XXXXXXXXXXXXXXXXXXX 
      volumes:
        - verifier-state:/usr/src/app/state
  volumes:
    verifier-state

```

#### Without Docker

In order to add the environment variables, create a file called `.env` in the the verifiers directory (the same directory that `package.json` is in) and
add environoment variables in that file using the format `VARIABLE_NAME=VALUE`. For example, when setting up the Discord verifier, your configuration
would look like:

```shell
DISCORD_OAUTH_URL=https://discord.com/api/oauth2/authorize?client_id=XXXXXXXXXXXXXXX&redirect_uri=XXXXXXXXXXXXXXX&response_type=code&scope=identify
DISCORD_REDIRECT_URL=https://your.verifier.com/platforms/discord/oauth/callback
DISCORD_CLIENT_SECRET=XXXXXXXXXXXXXXXXXXXX 
DISCORD_CLIENT_ID=XXXXXXXXXXXXXXXXXXX
```

### Installing Custom Verifiers

Harbor Verifiers comes preinstalled with verifiers for many popular platforms by default and includes support for adding custom for verifiers for any platform.
Custom verifiers are downloaded as `.ts` files. If you would like to use a custom verifier, you will need to follow the below steps:

#### With Docker Compose

In the same folder as your `docker-compose.yml` file, you need to create a folder called `custom-platforms`. Once you have done this, you will need to 
copy the verifier's `.ts` file into the `custom-platforms` folder. Once you have done this, add the highlighted line to your `docker-compose.yml` file: 


```yaml #8
version: '2'
  services: 
    verifiers:
      image: gitlab.futo.org:5050/videostreaming/verifiers:latest
      restart: unless-stopped 
      user: "${USER_ID}:${GROUP_ID}"
      volumes:
        - ./custom-platforms:/usr/src/app/src/platforms/custom
        - verifier-state:/usr/src/app/state
  volumes:
    verifier-state

```

Run the below command in order to load the new plugin:

Docker Compose v3:
```shell
docker compose up -d
```

Docker Compose v1 & v2:
```shell
docker-compose up -d
```


#### Without Docker

Copy the verifier's `.ts` file into the `src/platforms/custom` folder. Once you have done this, retart the verifiers server to load the new plugin.
