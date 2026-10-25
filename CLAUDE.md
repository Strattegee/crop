# CROP: notes for Claude sessions

## Product
Multi-tenant SaaS: first a roster for any employer; agencies plug in through an allocation module and fill shifts employers send them ("Agency fill", ranked agencies, timed escalation). See `docs/decisions/2026-10-25-roster-meeting.md`. Beta tenant: Caring For You (nursing agency, Victoria). Requirement IDs (ROS-, ALC-, CRD-, APP-, NOT-, CLP-, …) come from the CROP MVP Specification: https://claude.ai/artifact/5BSKf7k8EybB9JWnHzLPYt
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
- What to build next: `docs/BACKLOG.md` (priority order, decisions behind it). Scheduled runs follow `docs/WORKING-ALONE.md` and log in `docs/RUNLOG.md`. Progress page source: `docs/progress/`.
- CROP serves any industry (packs: healthcare, labour hire, construction, hospitality); use neutral terms (Client, Site, Area, Role, Shift). Rules are business defaults that a client or site can make stricter.
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
- Notifications (`apps/api/src/notifications`): queue a message with `queueNotification(db, tenantId, …)` inside `withTenant`; the `NotificationDispatcher` loop (Postgres queue, `app_claim_notifications`/`app_finish_notification`) sends it with retries (60s, 5m, 15m, 1h). Email: Resend (`EmailSender`); SMS: ClickSend (`SmsSender`), Australian mobiles only, monthly cap per agency (`tenant_settings.sms_monthly_cap`). Use a `dedupeKey` for anything that must only go once (reminders). Never put health information or document numbers in a message (vaccinations are "a vaccination record"); link to CROP for detail. Expiry reminders (`reminders.ts`, CRD-7): hourly, from 8am agency time; workers at 60/30/7 days (SMS only at 7), office owners/admins one daily digest (30 days, expiry day, expired), with a People and an Equipment section (current `equipment_checks` of non-retired equipment, plus how many upcoming bookings fall after the date); renewed credentials skipped; `reminder_marks` records what the digest has covered. Tests run with NOTIFY_DISPATCH=off and call `runOnce()`.
- Roster (`apps/api/src/roster`, migration 0009): `employment_terms` (effective-dated: a new term ends the previous one the day before), `shift_codes` (business-wide or per site, local times), `shifts` (one position each; times stored UTC, created from the site's local date and time; overnight when end < start), `shift_assignments` (who fills it; `resource_kind` is ready for equipment). Shift status follows the assignment: open → assigned → booked (confirmed); cancelling removes the assignment. Assigning locks the shift and the worker rows and refuses overlapping assignments (hard block). `GET /roster?from&to` returns shifts plus each active worker's terms and rostered hours.
- Eligibility (`roster/eligibility.ts`, pure; data in `eligibility-data.ts`): assigning is refused for the wrong role, a hard credential rule or right to work not met on the shift's local date, double booking, or a limited visa going over its hours in any 14 days starting on a Monday; warnings for expiring credentials, warning-level rules and rest under `tenant_settings.min_rest_hours`. `GET /shifts/:id/candidates` lists everyone active with blocks and warnings (ready first, then fewest hours that week). Reuse `eligibilityForShift` for bank fill and agency allocation.
- Equipment (`roster/equipment.controller.ts`, rules in `roster/equipment.ts`, migration 0011): `equipment_types` (optional `operator_credential_type_id`), `equipment` (active / out_of_service / retired), `equipment_checks` (dates that must be current, by name; a new one supersedes the current one). Equipment goes on a shift as a `shift_assignments` row with `resource_kind = 'equipment'` (status `confirmed`); a shift has at most one person and any number of equipment items, and shift status still follows the person. Booking locks the shift and the equipment rows. Hard blocks: not active, a date overdue on the shift's local date, overlapping booking, the person on the shift lacking a verified, current operator credential (also checked when assigning a person, via `operatorNeedsForShift`). Equipment-only shifts (migration 0012, `shifts.needs_person = false`, API `equipmentOnly`; role defaults to "Equipment only"): for dry hire; nobody can be assigned, no operator rule, status follows the equipment (booked while anything is on it). Bank fill, agency fill and needs-attention must skip them for people. Shifts include `equipmentOnly` and `equipment: [{id, name, typeName}]`; `GET /roster` adds `equipment` rows with `bookedHours`.
- Items (`apps/api/src/items`, rules in `items.ts`, migration 0013): `items` catalogue (category, unit, `unit_cost_cents`, optional `charge_cents` to the client, `tracks_stock`, `reorder_level`) and `stock_movements`, an append-only ledger (no UPDATE/DELETE for crop_app; kinds received / issued (to a person, optional shift) / used (on a shift) / returned / adjusted). On hand per site = sum of the site's movements; lock the item row before any movement. Quantities numeric(12,3), money in integer cents; each movement copies the cost and charge, so price changes never rewrite history. Corrections are new rows (return or stocktake), never edits. `GET /shifts/:id/items` and `GET /workers/:id/items` give net use with cost and charge.
- Bank fill (`roster/bank-fill.controller.ts`, helpers and message wording in `roster/bank-fill.ts`, migration 0014): `shift_offers` (pending / accepted / declined / withdrawn / filled; optional `expires_at`, shown as `expired` once past; no DELETE for crop_app). `GET /shifts/:id/bank-fill` (bank and casual staff by default, `everyone=true` for all), `POST /shifts/:id/offers` (everyone must be eligible; email and SMS unless `notify: false`), `POST /offers/:id/accept|decline` (office records the reply for now), `POST /shifts/:id/offers/withdraw`. Accepting locks the shift, then the offer, then the worker, re-checks eligibility and books (confirmed); the other pending offers close as filled. Assigning directly closes pending offers as filled and cancelling as withdrawn (`closePendingOffers` in `roster/offers-data.ts`).
- Dates like "today" come from the business's time zone (`todayIn(settings.timezone)`), never the server's UTC date.
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
