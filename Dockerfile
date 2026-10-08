# Landing CMS — builder + per-user file storage + SQLite, in one image.
# Website content lives on a mounted volume at /data (NEVER baked into the image).

# --- build the Angular frontend ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build                      # → dist/cms/browser

# --- runtime ---
FROM node:22-alpine
RUN apk add --no-cache git             # the CMS shells out to git for per-user history
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY site ./site                       # seed template copied into each new user's folder
COPY --from=build /app/dist/cms/browser ./public

ENV CMS_DATA_DIR=/data \
    CMS_SEED_DIR=/app/site \
    CMS_PUBLIC_DIR=/app/public \
    CMS_PORT=4310 \
    CMS_HOST=0.0.0.0 \
    CMS_SECURE_COOKIE=1

EXPOSE 4310
VOLUME ["/data"]
CMD ["node", "--experimental-sqlite", "server/index.mjs"]
