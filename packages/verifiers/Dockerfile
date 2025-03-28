FROM node:19

WORKDIR /usr/src/app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

RUN apt-get update && apt-get install curl gnupg -y \
  && curl --location --silent https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install google-chrome-stable -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY version.sh ./version.sh
COPY proto ./proto
COPY package*.json ./
COPY packages/verifiers/package*.json ./packages/verifiers/
COPY packages/polycentric-core/package*.json ./packages/polycentric-core/
COPY packages/polycentric-leveldb/package*.json ./packages/polycentric-leveldb/


# Install dependencies
RUN npm install
RUN npm install -g protoc

RUN mkdir -p server/src

# Copy source files
COPY packages/verifiers/tsconfig.json ./packages/verifiers/
COPY packages/verifiers/src ./packages/verifiers/src
COPY packages/polycentric-core/src ./packages/polycentric-core/src
COPY packages/polycentric-core/tsconfig.json ./packages/polycentric-core/
COPY packages/polycentric-leveldb/src ./packages/polycentric-leveldb/src
COPY packages/polycentric-leveldb/tsconfig.json ./packages/polycentric-leveldb/

RUN protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_opt=esModuleInterop=true --ts_proto_opt=forceLong=long --ts_proto_out=. --experimental_allow_proto3_optional proto/protocol.proto
RUN cp proto/protocol.ts packages/polycentric-core/src/protocol.ts

RUN ./version.sh

# Build the dependencies first
WORKDIR /usr/src/app/packages/polycentric-core
RUN npm run build

WORKDIR /usr/src/app/packages/polycentric-leveldb
RUN npm run build

# Switch back to verifiers and prepare state directory
WORKDIR /usr/src/app/packages/verifiers
RUN mkdir -p state && chown -R node:node state

USER node
EXPOSE 3002

CMD [ "npm", "start" ]
