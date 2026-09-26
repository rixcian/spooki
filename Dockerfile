FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    CLIENT_DIST=/app/client/dist \
    CRON_OUTPUT_DIR=/hermes/cron/output
WORKDIR /app/server
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist /app/client/dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
