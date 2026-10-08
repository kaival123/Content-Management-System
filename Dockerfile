# Landing CMS — a FULL-STACK app, not a static Angular site.
# One image runs the Node server, which serves BOTH the REST API and the built
# Angular frontend. Accounts + every user's websites live on the /data volume
# (SQLite + files) — never baked into the image.

# --- stage 1: build the Angular frontend ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build                      # → dist/cms/browser

# --- stage 2: runtime (Node server) ---
FROM node:22-alpine
RUN apk add --no-cache git             # the CMS shells out to git for per-user history
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY site ./site                       # seed template, copied into each new user's folder
COPY --from=build /app/dist/cms/browser ./public

# NOTE: CMS_SECURE_COOKIE is intentionally NOT set here. Set it to 1 only when the app
# is served over HTTPS (e.g. behind Caddy in docker-compose). Over plain HTTP a Secure
# cookie is never stored, which makes login silently fail.
ENV CMS_DATA_DIR=/data \
    CMS_SEED_DIR=/app/site \
    CMS_PUBLIC_DIR=/app/public \
    CMS_PORT=4310 \
    CMS_HOST=0.0.0.0

EXPOSE 4310
VOLUME ["/data"]

# /api/auth/me needs no session, so it's a safe liveness probe.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4310/api/auth/me >/dev/null 2>&1 || exit 1

CMD ["node", "--experimental-sqlite", "server/index.mjs"]
