# CROP: notes for Claude sessions

## Product
Multi-tenant SaaS for staffing agencies. Beta tenant: Caring For You (healthcare/nursing, Victoria). Requirement IDs (ROS-, ALC-, CRD-, APP-, NOT-, CLP-, …) come from the CROP MVP Specification: https://claude.ai/artifact/5BSKf7k8EybB9JWnHzLPYt
Build schedule: https://claude.ai/artifact/RtUPeMVpHrJbUZZAms7Dug

## Stack (decided)
- TypeScript modular monolith; pnpm workspaces.
- `apps/web`: Next.js (office and client portal). `apps/api`: NestJS REST API with OpenAPI. `apps/mobile`: React Native (Expo) worker app, iOS + Android, OTA updates, APNs/FCM push.
- PostgreSQL with row-level security on `tenant_id`; Postgres-backed job queue; SSE/WebSockets for live updates.
- Managed identity provider with 2FA.
- Hosting: DigitalOcean Sydney. Staging = Docker on droplet behind Caddy. Production = managed Postgres + Spaces.

## Data model rules
- Shift requirement, allocation, booking and placement are separate entities.
- Rates and employment are effective-dated.
- Credential requirements are data, not code.
- Store times in UTC plus the facility's IANA timezone.
- Eligibility: hard blocks vs warnings.

## Shift lifecycle
Open → Offered/Broadcast → Booked; Open → Assigned → Booked; Cancelled; Completed → Timesheet (Release 2).

## Working rules
- Each parallel Claude session works on its own branch and opens a PR into `main`.
- Australian English in UI copy. No real worker or patient data in fixtures.

## Repository layout and conventions
- `packages/db`: SQL migrations (`migrations/NNNN_name.sql`, applied in order, never edited after merge), `migrate()`, `createPool()`, `withTenant()`.
- `apps/api`: ES modules (`"type": "module"`); relative imports end in `.js`. Inject providers with explicit `@Inject(TOKEN)` (tests run under Vitest, which doesn't emit decorator metadata). Give `@ApiProperty` an explicit `type`.
- Every tenant-owned table: `tenant_id uuid not null references tenants(id)`, `enable` + `force row level security`, policy `tenant_id = app_tenant_id()` for using and with check. Add an isolation test.
- The API connects as `crop_app` (no BYPASSRLS). All tenant data access goes through `withTenant(pool, tenantId, fn)`. Migrations run as the owner role.
- `TenantGuard` currently trusts the `x-tenant` header. It is a placeholder until the identity provider is integrated and must not reach production.
- Tests: Vitest; DB tests create and drop their own database using `DATABASE_URL` (owner role).
- Versions: Node 22, pnpm 10, TypeScript 6.0, NestJS 12, Next.js 16, Expo SDK 58.

## Local development
```sh
pnpm install
docker compose up -d                       # Postgres on 5432 (or use a local Postgres 16)
cp .env.example .env
DATABASE_URL=postgres://crop:crop@localhost:5432/crop APP_DB_PASSWORD=crop_app pnpm db:migrate
pnpm --filter @crop/db build
pnpm dev                                   # API :4000 (docs at /docs), web :3000
pnpm --filter @crop/mobile start           # Expo; scan the QR code with Expo Go
```
Checks before a PR: `pnpm typecheck && pnpm test && pnpm build`.

## Deployment
Merges to `main` deploy to https://staging.cropwms.com (see `deploy/staging/README.md`).
