# CROP: notes for Claude sessions

## Product
Multi-tenant SaaS for staffing agencies. Beta tenant: Caring For You (healthcare/nursing, Victoria). Requirement IDs (ROS-, ALC-, CRD-, APP-, NOT-, CLP-, …) come from the CROP MVP Specification: https://claude.ai/artifact/5BSKf7k8EybB9JWnHzLPYt
Build schedule: https://claude.ai/artifact/RtUPeMVpHrJbUZZAms7Dug

## Stack (decided)
- TypeScript modular monolith; pnpm workspaces.
- `apps/web`: Next.js (office and client portal). `apps/api`: NestJS REST API with OpenAPI. `apps/mobile`: React Native (Expo) worker app, iOS + Android, OTA updates, APNs/FCM push.
- PostgreSQL with row-level security on `tenant_id`; Postgres-backed job queue; SSE/WebSockets for live updates.
- Identity provider: Zitadel Cloud, Australian region (decided 22 Oct 2026). OIDC with PKCE; JWT access tokens; 2FA enforced in Zitadel.
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
- Every tenant-owned table: `tenant_id uuid not null references tenants(id)`, `enable row level security` (not `force`), policy `tenant_id = app_tenant_id()` for using and with check. Add an isolation test. Tables are owned by the migration role, which bypasses RLS (needed for admin tools and security definer functions on managed Postgres, where the owner isn't a superuser); crop_app never owns tables.
- The API connects as `crop_app` (no BYPASSRLS). All tenant data access goes through `withTenant(pool, tenantId, fn)`. Migrations run as the owner role.
- Sign-in: a global `AuthGuard` verifies the Zitadel access token (AUTH_ISSUER, AUTH_AUDIENCE) on every route. Mark exceptions with `@Public()` (no sign-in) or `@NoTenant()` (signed in, no agency). Restrict with `@Roles(...)`; get the agency with `@Tenant()` and the person with `@Auth()`.
- People are platform-level `users` (crop_app can't read the table; it uses `app_user_by_subject`, `app_sign_in`, `app_user_memberships`). Access to an agency is a `membership` with one role: owner, admin, allocator (office), worker, client. Invitations by email are accepted at sign-in only when the identity provider says the email is verified.
- If someone belongs to several agencies, the client sends `x-tenant: <slug>`; the guard checks it is one of theirs.
- Web sign-in (`apps/web`): server-side OIDC code flow with PKCE (`openid-client`), routes `/auth/login`, `/auth/callback`, `/auth/logout` (POST). The access token lives in an encrypted httpOnly cookie (`lib/session.ts`); server components call the API with it via `lib/current-user.ts`. The browser never sees tokens. Env: AUTH_ISSUER, AUTH_CLIENT_ID, AUTH_PROJECT_ID, APP_URL, SESSION_SECRET (32+ chars).
- Workforce (`apps/api/src/workforce`): workers, credential types, requirement rules, worker credentials with verification and an append-only history (`credential_events`, no UPDATE/DELETE for crop_app). Compliance rules are pure functions in `compliance.ts` (unit-tested); pass a shift date as `onDate` for eligibility (CRD-8). Only verified credentials satisfy hard rules. Editing a verified credential's number or dates resets it to unverified.
- Right to work (CRD-6, `right-to-work.controller.ts`): its own record per worker (citizen / NZ citizen / permanent resident / visa holder) with status-specific fields; VEVO required for all non-citizens; visa expiry and hours-per-fortnight limit stored (the limit is for roster eligibility). New details replace the current record (`superseded_at`), history kept. Built into compliance as a hard rule for every worker (`rightToWorkIssue`); it is no longer a generic credential category.
- Documents (`apps/api/src/documents`): credential evidence in DigitalOcean Spaces (Sydney) via the `DocumentStore` interface (`MemoryStore` in tests and local dev). Uploads go through the API (10 MB, type checked from the file's bytes: PDF, JPEG, PNG, HEIC); storage keys contain no names; files open via 5-minute signed links; removal marks the row removed and keeps the object.
- Notifications (`apps/api/src/notifications`): queue a message with `queueNotification(db, tenantId, …)` inside `withTenant`; the `NotificationDispatcher` loop (Postgres queue, `app_claim_notifications`/`app_finish_notification`) sends it with retries (60s, 5m, 15m, 1h). Email: Resend (`EmailSender`); SMS: ClickSend (`SmsSender`), Australian mobiles only, monthly cap per agency (`tenant_settings.sms_monthly_cap`). Use a `dedupeKey` for anything that must only go once (reminders). Never put health or credential details in a message; link to CROP instead. Tests run with NOTIFY_DISPATCH=off and call `runOnce()`.
- API error messages are shown to users: use plain English (field labels in `common/validate.ts`).
- Tests: Vitest. `createTestDatabase()` (`@crop/db/dist/testing.js`) makes a throwaway database owned by a non-superuser, like production. API tests sign tokens with the fake identity provider in `apps/api/test/fake-idp.ts`.
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
