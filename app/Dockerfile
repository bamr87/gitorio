# syntax=docker/dockerfile:1
# Multi-stage build for the GitFactory static frontend.
#   dev   → Vite dev server with HMR (docker-compose `dev` service)
#   build → produces the production bundle in /app/dist
#   prod  → tiny nginx image serving the built assets

# ---- deps: install once, cache on package-lock ----
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: hot-reloading dev server ----
FROM base AS dev
ENV VITE_USE_POLLING=true
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ---- build: type-check + production bundle ----
FROM base AS build
COPY . .
RUN npm run build

# ---- prod: serve the static bundle ----
FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
