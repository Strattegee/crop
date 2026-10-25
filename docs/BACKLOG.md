# CROP backlog

The priority list for every Claude session, including scheduled runs. Work from the top down; take the first item that is not done, not marked **Waiting**, and not already being worked on (check open pull requests first). Update this file in the same pull request as the work: tick what you finished, add what you discovered.

## The product, as decided by David and Steve Thomson (25 Oct 2026 meeting)

- **CROP's main customer is the employer**: any small to medium business (restaurant, construction equipment, traffic management, hospital ward). The employer product is roster-first and must be simple to set up without help. Agencies are a second customer type, allocation-first, serving CROP employers and outside clients.
- **CROP's edge is a complete organisation system for staff, equipment and consumables.** Equipment (incl. vehicles) is rostered like people (booked for a time, one place at once, its own compliance dates, may need a licensed operator); items (PPE, fuel, sundries) are issued or used against shifts, jobs or people. Design every roster feature so equipment fits from day one.
- **CROP is first a roster for any employer**, in any industry: a hospital, a hotel, a construction firm. "The most important key to the success of this program is the system working as a roster for an employer."
- **The employer** owns the site and sets the credential criteria for its work. It rosters its own staff (full-time, part-time, casual and bank) and sees the roster by day, week or month, by department or by person, with each person's hours.
- **Bank staff** are the employer's own pool of relief staff. To fill a gap, the employer looks at them **as a list**: who is available today and qualified (like an allocation screen), and puts someone in.
- **Agency fill**: when the employer can't fill a shift, it presses *Agency fill*. The request goes to agencies that also use CROP (the **agency module**). The employer ranks its agencies (preference 1, 2, 3) and the request **escalates on a timer**: e.g. agency 1 gets it first, agency 2 is added after 10 minutes, agency 3 after 20. Times matter because shifts may be needed within hours.
- **The agency** (e.g. Caring For You) sees the request in its **allocation screen**: a multi-list of its own people who are available, for this facility or any of 20 others that day. It nominates who goes, or offers to its people and the first to respond goes. The agency worker must meet **exactly the same criteria** as the employer's own staff; employment conditions are the same. Once booked, the agency worker appears on the employer's roster.
- **Difference between the two modules**: an employer has a roster; an agency has allocations. Everything else (credentials, qualifications, expertise, rules) works the same.
- Industries: any. Industry packs in order: healthcare, labour hire, construction, hospitality. Rules are business defaults that a client or site can make stricter.
- CFY today: all CFY staff are CFY employees placed at client sites; clients order shifts (single or blocks) through a portal. CFY is CROP's first **agency**; its clients (hospitals, aged care) are future CROP **employers**.

## Now: the employer roster (Release 1 core)

1. [x] **Employer roster foundations.** Done 25 Oct: API and tests (`roster.controller.ts`); screens come with item 2. Model *resources* generally so a shift can need people and equipment (people built first, equipment rows to follow in item 4). Departments/areas within sites (sites and areas exist), staff with employment type (full-time, part-time, casual, bank) and contracted hours, shift codes (start, end, break) per site, and shifts on a roster with statuses (open, assigned, booked, cancelled). Times in UTC plus the site's time zone. Keep requirement, allocation and booking separate (CLAUDE.md). API and tests first.
2. [ ] **Roster screen (Ribbon).** Week view by department, by person and by equipment with hours and balance per person; day and month views; draft → publish → live with a change log. Use the prototype and the full-screen design as the starting point (Steve has endorsed the roster concept); keep it simple and fast.
3. [x] **Eligibility when assigning.** Done 25 Oct (scheduled run): `roster/eligibility.ts` (pure, unit-tested) and `GET /shifts/:id/candidates` (everyone active, ready first, with reasons). Hard blocks on assign: wrong role, hard credential rules and right to work on the shift date, double booking, visa hours over any fortnight starting on a Monday. Warnings: expiring credentials, warning-level rules, rest under the business minimum (`tenant_settings.min_rest_hours`, default 10). Still to do: site and client rules that are stricter than the business's (with Clients), availability and leave (item 10). Original brief: only staff who hold the role and every hard requirement on the shift date (`compliance.ts` with `onDate`), aren't double-booked, and are within visa hours and rest rules; warnings vs hard blocks.
4. [ ] **Equipment on the roster.** First slice done 25 Oct (scheduled run, migration 0011, `roster/equipment*.ts`): equipment types with an optional operator credential, an equipment register (asset number, rego, home site, active / out of service / retired), dates that must be current (registration, service, inspection…; a new date replaces the old, history kept), booking equipment to shifts (`POST /shifts/:id/equipment`, `GET /shifts/:id/equipment-candidates`) with hard blocks (out of service, a date overdue on the shift date, double booking, the person on the shift can't operate it) and warnings, the operator rule applied when assigning a person too, and equipment rows with booked hours on `GET /roster`. Equipment dates in the office's daily email done 25 Oct (scheduled run): 30 days before, on the day, and overdue, with how many shifts the machine is booked on after the date. Still to do: wet hire vs dry hire (with rates and clients), equipment on the roster screen (item 2), and equipment that needs its own booking without a person (e.g. a dry-hired machine on a client's job). Original brief: equipment register (type, registration/service/inspection dates with expiry reminders using the credential engine), book equipment to shifts with no double booking, operator rules (a machine needs an operator holding a given credential), equipment rows on the roster, wet hire vs dry hire.
5. [ ] **Items and consumables.** Item catalogue (PPE, fuel, sundries) with unit cost; issue items to a person or use them on a shift/job; quantities on hand per site; cost per shift and optional charge to the client.
6. [ ] **Bank fill.** For an open shift, a list of the employer's own bank and casual staff who are available and eligible, ranked; assign directly or offer to several and first to accept is booked (no double booking, enforced in the database). Notify by email/SMS now, push once the app exists.
7. [ ] **Agency connections.** An employer links to agencies (both CROP tenants) with a preference order and escalation times. Cross-tenant design needed: a shared request record both tenants can see, exposed through security-definer functions; the employer sees only what it needs about agency workers (name, role, compliant yes/no against its criteria), never their documents. **Write the design up in `docs/` and hold for David before building** (security-sensitive).
8. [ ] **Agency fill and the agency allocation screen.** Employer presses Agency fill; requests reach agency 1, then 2, then 3 on the timer; the agency's allocation screen lists open requests across all its client facilities and its available, eligible people; agency nominates or broadcasts; booked agency worker appears on the employer's roster.
9. [ ] **Worker app: sign-in and shifts.** Expo app: Zitadel sign-in (check whether 396209764272477215 is the Worker App's client ID), my shifts, open offers with accept/decline, availability and leave, my credentials with upload. Push notifications.
10. [ ] **Availability and leave.** Staff record availability (by day and AM/PM/night) and leave; the roster, bank fill and allocations use it.
11. [ ] **Recruitment and onboarding** (agency and employer): apply, review, request documents, approve, activate; onboarding checklist with progress.
12. [ ] **Needs-attention list** for the employer and the agency: open shifts starting soon, offers with no reply, escalations, compliance problems on booked shifts.

## Next

- [ ] Clients that don't use CROP yet: a simple portal for an agency's clients to order shifts (CFY's current clients). Confirm with David whether this is a light employer account.
- [ ] Industry packs: healthcare (current starter list), labour hire, construction, hospitality — roles, shift codes, credential types, default rules. Neutral wording in the UI (Client, Site, Area, Role, Shift).
- [ ] Audit log of office actions (finishes AUTH).
- [ ] Remove the leftover "Right to work" credential type rows created before right to work had its own section (staging test data only).
- [ ] Employment records (effective-dated) for workers.
- [ ] Office screens for equipment (register, dates, booking to shifts): the API exists, no web page yet. Comes with or after the roster screen (item 2).
- [ ] Check other date checks use the business's time zone, not the server's (found 25 Oct: the VEVO "not in the future" check used UTC, so a Melbourne morning entry of today's date was refused; fixed).

## Later

- Expenses and travel claims from the app (with Release 2).
- Release 2: timesheets, pay and invoice export; agency invoices the employer.
- AI auto-fill (intake of requests by email/text, waves of offers) after Release 1.

## Waiting on David or others

- Roster screen (item 2): scheduled runs left it for a session with David, because `docs/WORKING-ALONE.md` holds Ribbon roster design for Steve's review. Confirm whether the 25 Oct meeting counts as that review, so runs can build it.

- Open questions from the 25 Oct meeting (see `docs/decisions/2026-10-25-roster-meeting.md`).
- ClickSend dedicated number (David, Mon 26 Oct) → set `CLICKSEND_FROM`.
- Apple developer verification.
- CFY: credential list and rules; which Entire statuses and reports they use.
