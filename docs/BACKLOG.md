# CROP backlog

The priority list for every Claude session, including scheduled runs. Work from the top down; take the first item that is not done, not marked **Waiting**, and not already being worked on (check open pull requests first). Update this file in the same pull request as the work: tick what you finished, add what you discovered.

Decisions behind the order (David, 25 Oct 2026):
- CROP is a product for any industry, not just healthcare. Industry packs in order: healthcare, labour hire, construction, hospitality. A business can serve several industries.
- Rules (rest, hours, credentials) are set for the business as defaults; a client or site can add stricter ones.
- For Caring For You (CFY), all staff are CFY employees (casual, part-time, full-time) placed at client sites. Clients book single shifts or blocks of shifts; they do not roster.
- CFY's first release must cover day-to-day shift filling: client requests a shift → qualification and credentials needed → compliant, available workers found → offered to the casual pool → accepted → everyone notified. Recruitment (apply, approve, activate) feeds the pool. All connected to the worker app.
- The Ribbon roster comes after Steve Thomson reviews it (see `docs/progress` and the roster agenda). Don't build Ribbon screens until then.

## Now: shift filling (Release 1 core)

1. [ ] **Shifts and shift requests (ALC).** Data model and API: a request from a client for a site, area, role, date/times, number of people, required qualification and extra credentials; single or a block (date range, days of week). Each request creates shifts. Keep requirement, allocation and booking separate (CLAUDE.md). Statuses: open, offered, booked, cancelled, completed. Times in UTC plus the site's time zone. Office screens: create request, list open shifts by day, shift detail.
2. [ ] **Eligibility and matching.** For a shift, list workers who hold the role and every hard requirement on that date (use `compliance.ts` with `onDate`), are not booked at an overlapping time, are within visa hour limits and rest rules; warnings vs hard blocks. Rank by priority, past work at the site, hours this week. Office can assign directly.
3. [ ] **Offers and broadcast.** Offer a shift to chosen workers or broadcast to all eligible; first to accept is booked (no double booking, enforced in the database); others told it's filled. Notify by email/SMS now (link to a simple accept page), push once the app exists. Office sees who was offered, opened, declined.
4. [ ] **Worker availability.** Workers (and office on their behalf) record availability by day and AM/PM/night, plus leave; matching uses it.
5. [ ] **Worker app: sign-in and shifts.** Expo app: Zitadel sign-in (check whether 396209764272477215 is the Worker App's client ID), my shifts, open offers with accept/decline, availability, my credentials with upload. Push notifications.
6. [ ] **Client portal: request shifts.** Client users (role `client`) request single shifts or blocks for their sites, see who is booked, cancel with a reason.
7. [ ] **Recruitment and onboarding.** Apply (public form), office reviews, requests documents, approves, activates; onboarding checklist per worker with progress (Entire's personnel card checklist is a good reference for coverage, not layout).
8. [ ] **Needs-attention list.** Office dashboard: open shifts starting soon, offers with no reply, compliance problems on booked shifts, expiring credentials.

## Next

- [ ] Industry packs: healthcare (current starter list), labour hire, construction, hospitality — roles, shift codes, credential types, default rules. Neutral wording in the UI (Client, Site, Area, Role, Shift).
- [ ] Audit log of office actions (finishes AUTH).
- [ ] Remove the leftover "Right to work" credential type rows created before right to work had its own section (staging test data only).
- [ ] Clients: contacts, client-level rules UI.
- [ ] Employment records (effective-dated) for workers.

## Later

- Ribbon roster (after Steve's review) — prototype and agenda are design input, not decisions.
- Resources: equipment (incl. vehicles) and items on shifts; wet/dry hire.
- Expenses and travel claims from the app (with Release 2).
- Release 2: timesheets, pay and invoice export.
- AI auto-fill (intake of requests by email/text, waves of offers) after Release 1.

## Waiting on David or others

- ClickSend dedicated number (David, Mon 26 Oct) → set `CLICKSEND_FROM`.
- Apple developer verification.
- Steve's answers on the Ribbon roster.
- CFY: credential list and rules; which Entire statuses and reports they use.
