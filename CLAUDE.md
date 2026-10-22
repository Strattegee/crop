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
