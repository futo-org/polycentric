FROM node:23.6.1-bookworm AS deps

ENV NPM_CONFIG_LOGLEVEL=warn
WORKDIR /app

RUN apt-get update && apt-get install -y protobuf-compiler libnss3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/polycentric-core/package.json packages/polycentric-core/
COPY packages/polycentric-react/package.json packages/polycentric-react/
COPY packages/polycentric-leveldb/package.json packages/polycentric-leveldb/
COPY packages/polycentric-desktop/package.json packages/polycentric-desktop/

# Install workspace dependencies
RUN npm install

# Generate ts from protobuf
COPY ./proto ./proto
RUN protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto \
    --ts_proto_opt=esModuleInterop=true \
    --ts_proto_opt=forceLong=long \
    --ts_proto_out=. \
    --experimental_allow_proto3_optional ./proto/protocol.proto

COPY packages/polycentric-core /app/packages/polycentric-core
RUN cp /app/proto/protocol.ts /app/packages/polycentric-core/src/protocol.ts

WORKDIR /app/packages/polycentric-core
RUN npm run build

COPY ./packages/polycentric-react/ /app/packages/polycentric-react/

WORKDIR /app/packages/polycentric-react
RUN npm run build

COPY ./packages/polycentric-leveldb/ /app/packages/polycentric-leveldb/

WORKDIR /app/packages/polycentric-leveldb/
RUN npm run build

COPY ./packages/polycentric-desktop/ /app/packages/polycentric-desktop/

WORKDIR /app/packages/polycentric-desktop
RUN npm run build

CMD ["npm", "run", "dev:remote"]