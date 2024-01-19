FROM node:21 AS BUILD

WORKDIR "/app"

# Install app dependencies
COPY . /app/
RUN npm ci

FROM oven/bun:1

ENV NODE_ENV production
ENV PATH_CONFIG /config
ENV PATH_DATA /data
ENV HOMESERVER_NAME synapse
ENV HOMESERVER_URL http://synapse:8008

WORKDIR "/app"

COPY . /app/
COPY --from=BUILD /app/node_modules/ node_modules/

# API port
EXPOSE 9998
# AppService port
EXPOSE 9999
CMD ["bun", "run", "src/index.ts"]
