FROM node:18

WORKDIR /polycentric

RUN mkdir -p server/src/

# Copy the entire monorepo
COPY version.sh version.sh
COPY packages/polycentric-core packages/polycentric-core
COPY packages/polycentric-react packages/polycentric-react
COPY packages/polycentric-web packages/polycentric-web
COPY package.json package.json
COPY package-lock.json package-lock.json

RUN ./version.sh

# Install root dependencies
RUN npm install

# Setup polycentric-core with minimal stubs for the imports
WORKDIR /polycentric/packages/polycentric-core
RUN npm run build 

WORKDIR /polycentric/packages/polycentric-react
RUN npm run build 

WORKDIR /polycentric/packages/polycentric-web
RUN npm run build 
RUN npm install -g wrangler

WORKDIR /polycentric/

CMD ["wrangler", "pages", "deploy", "--project-name", "polycentric-spa-staging", \
"./packages/polycentric-web/dist/", "--branch", "master"]
