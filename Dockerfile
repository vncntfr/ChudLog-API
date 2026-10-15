FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY api/package.json api/package.json
RUN npm ci && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/data/chudlog.db
COPY --from=dependencies /app/node_modules node_modules
COPY package.json package.json
COPY shared shared
COPY api api
RUN mkdir /data /backups && chown node:node /data /backups
USER node
EXPOSE 8787
CMD ["npm", "--workspace", "api", "start"]
