# Registry manifest verified 2026-09-18; Linux native modules build inside Linux.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY vendor ./vendor
ENV SKIP_INSTALL_SIMPLE_GIT_HOOKS=1
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY vendor ./vendor
COPY server ./server
COPY shared ./shared
USER node
STOPSIGNAL SIGTERM
CMD ["node", "server/index.ts"]
