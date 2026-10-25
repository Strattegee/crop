# CROP backlog

The priority list for every Claude session, including scheduled runs. Work from the top down; take the first item that is not done, not marked **Waiting**, and not already being worked on (check open pull requests first). Update this file in the same pull request as the work: tick what you finished, add what you discovered.

## The product, as decided by David and Steve Thomson (25 Oct 2026 meeting)

- **CROP's main customer is the employer**: any small to medium business (restaurant, construction equipment, traffic management, hospital ward). The employer product is roster-first and must be simple to set up without help. Agencies are a second customer type, allocation-first, serving CROP employers and outside clients.
- **CROP is first a roster for any employer**, in any industry: a hospital, a hotel, a construction firm. "The most important key to the success of this program is the system working as a roster for an employer."
- **The employer** owns the site and sets the credential criteria for its work. It rosters its own staff (full-time, part-time, casual and bank) and sees the roster by day, week or month, by department or by person, with each person's hours.
- **Bank staff** are the employer's own pool of relief staff. To fill a gap, the employer looks at them **as a list**: who is available today and qualified (like an allocation screen), and puts someone in.
- **Agency fill**: when the employer can't fill a shift, it presses *Agency fill*. The request goes to agencies that also use CROP (the **agency module**). The employer ranks its agencies (preference 1, 2, 3) and the request **escalates on a timer**: e.g. agency 1 gets it first, agency 2 is added after 10 minutes, agency 3 after 20. Times matter because shifts may be needed within hours.
- **The agency** (e.g. Caring For You) sees the request in its **allocation screen**: a multi-list of its own people who are available, for this facility or any of 20 others that day. It nominates who goes, or offers to its people and the first to respond goes. The agency worker must meet **exactly the same criteria** as the employer's own staff; employment conditions are the same. Once booked, the agency worker appears on the employer's roster.
- **Difference between the two modules**: an employer has a roster; an agency has allocations. Everything else (credentials, qualifications, expertise, rules) works the same.
- Industries: any. Industry packs in order: healthcare, labour hire, construction, hospitality. Rules are business defaults that a client or site can make stricter.
- CFY today: all CFY staff are CFY employees placed at client sites; clients order shifts (single or blocks) through a portal. CFY is CROP's first **agency**; its clients (hospitals, aged care) are future CROP **employers**.

## Now: the employer roster (Release 1 core)

1. [ ] **Employer roster foundations.** Departments/areas within sites (sites and areas exist), staff with employment type (full-time, part-time, casual, bank) and contracted hours, shift codes (start, end, break) per site, and shifts on a roster with statuses (open, assigned, booked, cancelled). Times in UTC plus the site's time zone. Keep requirement, allocation and booking separate (CLAUDE.md). API and tests first.
2. [ ] **Roster screen (Ribbon).** Week view by department and by person with hours and balance per person; day and month views; draft → publish → live with a change log. Use the prototype and the full-screen design as the starting point (Steve has endorsed the roster concept); keep it simple and fast.
3. [ ] **Eligibility when assigning.** Only staff who hold the role and every hard requirement on the shift date (`compliance.ts` with `onDate`), aren't double-booked, and are within visa hours and rest rules; warnings vs hard blocks.
4. [ ] **Bank fill.** For an open shift, a list of the employer's own bank and casual staff who are available and eligible, ranked; assign directly or offer to several and first to accept is booked (no double booking, enforced in the database). Notify by email/SMS now, push once the app exists.
5. [ ] **Agency connections.** An employer links to agencies (both CROP tenants) with a preference order and escalation times. Cross-tenant design needed: a shared request record both tenants can see, exposed through security-definer functions; the employer sees only what it needs about agency workers (name, role, compliant yes/no against its criteria), never their documents. **Write the design up in `docs/` and hold for David before building** (security-sensitive).
6. [ ] **Agency fill and the agency allocation screen.** Employer presses Agency fill; requests reach agency 1, then 2, then 3 on the timer; the agency's allocation screen lists open requests across all its client facilities and its available, eligible people; agency nominates or broadcasts; booked agency worker appears on the employer's roster.
7. [ ] **Worker app: sign-in and shifts.** Expo app: Zitadel sign-in (check whether 396209764272477215 is the Worker App's client ID), my shifts, open offers with accept/decline, availability and leave, my credentials with upload. Push notifications.
8. [ ] **Availability and leave.** Staff record availability (by day and AM/PM/night) and leave; the roster, bank fill and allocations use it.
9. [ ] **Recruitment and onboarding** (agency and employer): apply, review, request documents, approve, activate; onboarding checklist with progress.
10. [ ] **Needs-attention list** for the employer and the agency: open shifts starting soon, offers with no reply, escalations, compliance problems on booked shifts.

## Next

- [ ] Clients that don't use CROP yet: a simple portal for an agency's clients to order shifts (CFY's current clients). Confirm with David whether this is a light employer account.
- [ ] Industry packs: healthcare (current starter list), labour hire, construction, hospitality — roles, shift codes, credential types, default rules. Neutral wording in the UI (Client, Site, Area, Role, Shift).
- [ ] Audit log of office actions (finishes AUTH).
- [ ] Remove the leftover "Right to work" credential type rows created before right to work had its own section (staging test data only).
- [ ] Employment records (effective-dated) for workers.

## Later

- Resources: equipment (incl. vehicles) and items on shifts; wet/dry hire.
- Expenses and travel claims from the app (with Release 2).
- Release 2: timesheets, pay and invoice export; agency invoices the employer.
- AI auto-fill (intake of requests by email/text, waves of offers) after Release 1.

## Waiting on David or others

- Open questions from the 25 Oct meeting (see `docs/decisions/2026-10-25-roster-meeting.md`).
- ClickSend dedicated number (David, Mon 26 Oct) → set `CLICKSEND_FROM`.
- Apple developer verification.
- CFY: credential list and rules; which Entire statuses and reports they use.
