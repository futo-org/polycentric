FROM node:18

WORKDIR /polycentric

RUN mkdir -p server/src/

# Copy the entire monorepo
COPY version.sh version.sh
COPY proto proto
COPY packages/polycentric-core packages/polycentric-core
COPY packages/polycentric-react packages/polycentric-react
COPY packages/polycentric-web packages/polycentric-web
COPY package.json package.json
COPY package-lock.json package-lock.json

RUN ./version.sh

# Install root dependencies
RUN npm install
RUN npm install -g protoc

RUN protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_opt=esModuleInterop=true --ts_proto_opt=forceLong=long --ts_proto_out=. --experimental_allow_proto3_optional proto/protocol.proto
RUN cp proto/protocol.ts packages/polycentric-core/src/protocol.ts



# Setup polycentric-core with minimal stubs for the imports
WORKDIR /polycentric/packages/polycentric-core
RUN npm run build 

WORKDIR /polycentric/packages/polycentric-react
RUN npm run build 

WORKDIR /polycentric/packages/polycentric-web
RUN npm run build 
RUN npm install -g wrangler

WORKDIR /polycentric/
