FROM node:22.13.1-bookworm AS deps

ENV NPM_CONFIG_LOGLEVEL=warn
WORKDIR /app

RUN apt-get update && apt-get install -y protobuf-compiler && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/polycentric-core/package.json packages/polycentric-core/
COPY packages/polycentric-react/package.json packages/polycentric-react/
COPY packages/polycentric-web/package.json packages/polycentric-web/

# Install workspace dependencies
RUN npm install --loglevel=warn 2>&1 | tee /var/log/npm-warnings.log

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

COPY ./packages/polycentric-web/ /app/packages/polycentric-web/

WORKDIR /app/packages/polycentric-web
RUN npm run build

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]