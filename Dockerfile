FROM node:24 AS build-backend

# Install app dependencies
WORKDIR "/app"
COPY . /app/
RUN npm ci

FROM oven/bun:1 AS build-frontend
ARG VERSION_HASH=local
ARG VERSION_NAME=local
ARG VERSION_CREATOR=local

# Build frontend
WORKDIR "/app"
COPY . /app/
WORKDIR "/app/frontend"
RUN bun install --frozen-lockfile
RUN bun build.ts



FROM oven/bun:1


ARG VERSION_HASH=local
ARG VERSION_NAME=local
ARG VERSION_CREATOR=local

ENV VERSION_HASH="${VERSION_HASH}" VERSION_NAME="${VERSION_NAME}" VERSION_CREATOR="${VERSION_CREATOR}"
ENV NODE_ENV=production PATH_CONFIG=/config PATH_DATA=/data HOMESERVER_NAME=synapse HOMESERVER_URL=http://synapse:8008

WORKDIR "/app"

COPY . /app/
COPY --from=build-backend /app/node_modules/ node_modules/
COPY --from=build-frontend /app/public/ public/

# Make the build fail if @matrix-org/matrix-sdk-crypto-nodejs wasn't installed correctly.
# error: Cannot find module "@matrix-org/matrix-sdk-crypto-nodejs" from "/home/bun/.bun/install/cache/matrix-bot-sdk@0.7.1/lib/e2ee/CryptoClient.js"
RUN bun test-sdk.ts

# API port
EXPOSE 9998
# AppService port
EXPOSE 9999
CMD ["bun", "run", "src/index.ts"]
