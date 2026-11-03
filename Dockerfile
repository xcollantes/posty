# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    MEDIA_DIR=/data/media \
    MIGRATIONS_DIR=/app/drizzle
# Full production node_modules first (the worker needs them), then the
# standalone server on top (its traced node_modules are a subset).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p /data/media && chown -R node:node /data
USER node
EXPOSE 3000
# The app runs migrations (and seeds the first admin) before serving.
CMD ["sh", "-c", "node dist/scripts/migrate.mjs && exec node server.js"]
