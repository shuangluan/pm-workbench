# Builds the web app image used by compose.yaml. Not yet published as a
# prebuilt image; `docker compose up --build` builds it locally.

FROM node:24.14.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/model-adapters/package.json packages/model-adapters/
COPY apps/worker/package.json apps/worker/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24.14.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3210 \
    PEW_BIND=0.0.0.0 \
    PEW_DATA_DIR=/data \
    PEW_MIGRATIONS_DIR=/app/migrations
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3210
CMD ["npm", "start"]
