FROM node:21 AS BUILD

WORKDIR "/app"

# Install app dependencies
COPY . /app/
RUN npm ci

FROM oven/bun:1

ENV NODE_ENV production

WORKDIR "/app"

COPY . /app/
COPY --from=BUILD /app/node_modules/ node_modules/

# AppService port
EXPOSE 9999
CMD ["bun", "run", "src/index.ts"]
