FROM node:19

WORKDIR /usr/src/app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

RUN apt-get update && apt-get install curl gnupg -y \
  && curl --location --silent https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install google-chrome-stable -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY packages/verifiers/package*.json ./packages/verifiers/
COPY packages/polycentric-core/package*.json ./packages/polycentric-core/
COPY packages/polycentric-leveldb/package*.json ./packages/polycentric-leveldb/

# Install dependencies
RUN npm install

# Copy source files
COPY packages/verifiers/tsconfig.json ./packages/verifiers/
COPY packages/verifiers/src ./packages/verifiers/src
COPY packages/polycentric-core/src ./packages/polycentric-core/src
COPY packages/polycentric-core/tsconfig.json ./packages/polycentric-core/
COPY packages/polycentric-leveldb/src ./packages/polycentric-leveldb/src
COPY packages/polycentric-leveldb/tsconfig.json ./packages/polycentric-leveldb/

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
