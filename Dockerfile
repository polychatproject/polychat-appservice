FROM oven/bun:1

ENV NODE_ENV production

WORKDIR "/app"

COPY . /app/
RUN bunx npm ci --no-audit

# AppService port
EXPOSE 9999
CMD ["bun", "run", "src/index.ts"]
