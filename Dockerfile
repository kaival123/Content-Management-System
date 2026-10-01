# CMS: the built app and the project server in one image. See DEPLOY.md.
# Content lives in /app/site: mount it as a volume so it survives new images.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
# git: optional, for Developer mode's Git panel.
RUN apk add --no-cache git
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist/cms/browser ./dist/cms/browser
COPY server ./server
COPY package.json ./
COPY site ./site
EXPOSE 8080
VOLUME /app/site
CMD ["node", "server/index.mjs", "--prod"]
