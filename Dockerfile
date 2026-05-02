# syntax=docker/dockerfile:1

# ── Builder stage ─────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install all deps (build needs vite/react-router/prisma CLI/typescript).
RUN npm ci

COPY . .

# react-router build emits build/{client,server}; prisma generate produces
# the @prisma/client engine bindings used at runtime.
RUN npm run build && npx prisma generate

# Drop dev deps from node_modules so we copy a slimmer tree to runtime.
RUN npm prune --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
EXPOSE 3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# `npm run setup` runs prisma migrate deploy then `npm run start` boots the
# react-router server. Migrations are idempotent so this is safe on every boot.
CMD ["npm", "run", "docker-start"]
