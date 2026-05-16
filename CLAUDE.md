# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

REAL TRY ON — a Shopify embedded app (admin) plus a theme app extension (storefront widget) that adds an AI **Virtual Try-On** button to product pages. Storefront widget collects a shopper photo, posts it to the app's API, which runs it through a pluggable AI provider (FASHN.ai → Replicate fallback → mock) and returns a generated try-on image. Forked from the Shopify React Router template (note: React Router 7, **not** Remix).

## Common commands

```
npm run dev          # shopify app dev — tunnel + Vite, the only way to run locally
npm run build        # react-router build
npm run start        # serves the built app (build/server/index.js)
npm run setup        # prisma generate && prisma migrate deploy — REQUIRED on fresh checkout
npm run lint         # eslint
npm run typecheck    # react-router typegen + tsc --noEmit
npm run deploy       # shopify app deploy (also pushes config from shopify.app.toml)
npm run graphql-codegen   # regen GraphQL types after editing queries
```

There is no test runner configured. Don't claim test coverage.

**Windows ARM64 Prisma quirk:** if Prisma's `query_engine-windows.dll.node` fails to load, set `PRISMA_CLIENT_ENGINE_TYPE=binary` in the env.

## Architecture

### Two surfaces, one backend

1. **Admin app** (`app/` — React Router 7, embedded in Shopify admin via App Bridge). Routes follow `@react-router/fs-routes` flat-routes convention (see `app/routes.ts`). Server-only code uses the `*.server.ts` suffix. Authentication is handled by `app/shopify.server.ts`; the merchant-facing routes live under `app.*` (dashboard, settings, analytics, billing).

2. **Theme app extension** (`extensions/virtual-tryon-block/`) — a Liquid block (`blocks/tryon-button.liquid`) that merchants add to product pages via the theme editor. The block ships its own `assets/tryon-widget.js` and `assets/tryon-widget.css`. The widget reads `data-app-url` from the block settings and calls back into the admin app's API endpoints. There is also a `extensions/checkout-ui/` extension scaffold.

### Storefront → app API contract (Shopify App Proxy)

The widget calls **same-origin** to the storefront via Shopify App Proxy. Configured in `shopify.app.toml` `[app_proxy]` (subpath `realtryon`, prefix `apps`). Storefront URLs of the form `https://<shop>.myshopify.com/apps/realtryon/...` are HMAC-signed by Shopify and forwarded to `${app_proxy.url}/...` on the app:

- `GET  /apps/realtryon/tryon/generate` → returns the shop's widget config (button colors, theme, rules). Loader in `app/routes/proxy.tryon.generate.tsx`.
- `POST /apps/realtryon/tryon/generate` (multipart form) → runs the full generation flow. Action in the same file.
- `POST /apps/realtryon/tryon/events` → analytics ingestion (`app/routes/proxy.tryon.events.tsx`).

All three call `await authenticate.public.appProxy(request)` to verify the HMAC and obtain `session.shop`. **Never read `shop` from the body** — it would be spoofable. The widget no longer sends a `shop` field at all.

### Generation pipeline (`app/services/`)

`proxy.tryon.generate.tsx` orchestrates:

1. `image-processor.server.ts` — validates the upload (mime/size/ext), resizes with sharp to ≤2048px, strips EXIF, then uploads to **Cloudflare R2** via `r2.server.ts` at key `tryon/<shop_underscored>/<uuid>.<ext>`. Returns a 1-hour **signed GET URL** that's safe to hand to FASHN/Replicate. R2 lifecycle rules expire the prefix automatically; there is no local-disk path and no cleanup cron in the app.
2. `tryon-engine.server.ts` — provider abstraction. Order: FASHN if `FASHN_API_KEY` set → Replicate (IDM-VTON) if `REPLICATE_API_TOKEN` set → mock (returns a placeholder URL). Both real providers create a job then poll for completion (FASHN: 60s timeout, Replicate: 120s). When adding a new provider, follow the `TryOnRequest`/`TryOnResult` contract and slot it into `generateTryOn`.
3. `quota.server.ts` — monthly quota tracked on `Shop.usedQuota`/`monthlyQuota`. Resets on the 1st of each month (lazy: checked on each call).

Each generation creates a `Generation` row (`status: "processing"` → `"completed"|"failed"`) and a series of `AnalyticsEvent` rows.

### Data model (`prisma/schema.prisma`, PostgreSQL)

- `Session` — Shopify offline session storage (managed by `@shopify/shopify-app-session-storage-prisma`). Has `refreshToken`/`refreshTokenExpires` because the app opts into the `expiringOfflineAccessTokens` future flag.
- `Shop` — keyed by `shopDomain`, holds widget customization, product targeting rules, plan/quota. Created/updated in the `afterAuth` hook in `app/shopify.server.ts` — this is the side effect that bridges Shopify auth into our domain model.
- `Generation`, `AnalyticsEvent` — append-only records cascade-deleted with the shop.

The datasource is `postgresql` (`DATABASE_URL`); migrations live in `prisma/migrations/`. `npm run setup` runs `prisma migrate deploy` — required on a fresh checkout and in the Docker entrypoint.

### Shopify config (`shopify.app.toml`)

- API version: `2026-07` for webhooks; `ApiVersion.October25` in `app/shopify.server.ts`.
- Scopes: `write_products,write_metaobjects,write_metaobject_definitions`.
- Webhooks declared in the toml (sync on `npm run deploy`): `app/uninstalled`, `app/scopes_update`, plus the three GDPR-mandatory topics — `customers/data_request`, `customers/redact`, `shop/redact`. Handlers in `app/routes/webhooks.*.tsx` all use `authenticate.webhook(request)`.
- App Proxy: `[app_proxy]` block maps `apps/realtryon` → `${app_proxy.url}/...` (which routes to the `proxy.*.tsx` files).
- Billing: managed pricing — paid plans (`Starter`, `Growth`, `Pro`) declared in `shopifyApp({ billing })` in `shopify.server.ts`. The `Free` plan is the implicit default, no entry. `app/routes/app.billing.tsx` uses `billing.check` / `billing.request` / `billing.cancel`. Set `SHOPIFY_BILLING_TEST=false` in production.

## Conventions to follow

- **Embedded-app navigation:** never use `<a>` or `redirect` from `react-router`. Use `Link`/`useSubmit` from `react-router`, and the `redirect` returned from `authenticate.admin`. Otherwise the iframe session breaks.
- **Server files end in `.server.ts`** — the React Router compiler strips them from client bundles. Anything reading env vars, hitting the DB, or using `fs` must follow this.
- **GraphQL:** `.graphqlrc.ts` defaults to the Admin API. If you add Storefront API queries, update it.
- **Defer / `await`:** the Cloudflare tunnel used by `shopify app dev` buffers streamed responses, so streaming behavior won't show locally — switch to localhost-based dev to test it (see README "Defer & await" section).

## Env vars

See `.env.example` for the full list. Notable ones:
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` — set automatically by `shopify app dev`.
- `DATABASE_URL` — Postgres connection string.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — Cloudflare R2 for shopper photos.
- `FASHN_API_KEY` (+ optional `FASHN_API_URL`) — primary provider; `REPLICATE_API_TOKEN` — fallback.
- `MAX_IMAGE_SIZE_MB` (default 10).
- `SHOPIFY_BILLING_TEST` — `true` (default) for test charges; `false` in production.
- `SHOP_CUSTOM_DOMAIN` — optional, for shops on custom domains.
- `NODE_ENV=production` in production.

Without `FASHN_API_KEY` and `REPLICATE_API_TOKEN`, the engine falls back to a mock that returns a placeholder image — useful for end-to-end UI testing without burning API credits.

## Deployment

Containerized via `Dockerfile`; the image entrypoint runs `npm run docker-start` (`prisma migrate deploy` then `react-router-serve`). `railway.toml` deploys on Railway using that Dockerfile, with the health/uninstall webhook path wired to `/webhooks/app/uninstalled`. Production requires `DATABASE_URL` (Postgres), the R2 vars, and `SHOPIFY_BILLING_TEST=false`.

## Shopify Dev MCP

This repo configures the Shopify Dev MCP (`.cursor/mcp.json`, `.mcp.json`). Use it for up-to-date Admin API schema lookups and Shopify docs rather than guessing from training data.
