# 6. SERVICE LEVEL, SECURITY AND DATA LIFECYCLE SCHEDULES

## Schedule A — Service Levels (proposal, not operative until capabilities verified)

- Availability: \[SELECT VALIDATED UPTIME COMMITMENT, e.g. 99.9% per calendar month\]. Do not promise this until monitoring, exclusions and capacity support it.

- Maintenance: planned maintenance announced at least \[X\] hours in advance except urgent security changes; minimise disruption to scheduled rosters.

- Support: \[CHANNELS, TIME ZONE, BUSINESS HOURS, SEVERITY DEFINITIONS, INITIAL RESPONSE TARGETS\]. Distinguish response time from resolution time.

- Credits: where a committed availability target is missed and valid exclusions do not apply, customer may request a proportionate service credit \[FORMULA / CLAIM WINDOW\]. Credits must not extinguish statutory remedies.

- Exclusions: documented scheduled maintenance, customer-side networks/devices, customer-caused misuse and broadly affecting internet failures beyond Provider’s reasonable control, but not Provider’s foreseeable capacity or supplier failures automatically.

## Schedule B — Security Commitments (verify before publishing)

- Hosting: primary production data storage in Australian regions, with verified backup and disaster-recovery locations.

- Authentication: strong password handling, two-factor sign-in required, secure session handling and role-based access.

- Infrastructure: TLS in transit, encryption at rest, documented key management, secret rotation and tenant separation.

- Operational controls: least privilege, access logging, software patching, vulnerability management, security incident response and periodic restoration tests.

- Supplier controls: signed processing/security terms, inventory, risk review, overseas access mapping, and notices for material changes.

- Assurance: \[TEST SCHEDULE\], \[RELEVANT CERTIFICATIONS IF ACTUALLY OBTAINED\], contact for vulnerability reports \[EMAIL\].

## Schedule C — Data Lifecycle and Exit (proposed defaults to approve)

- During service: customer can access/export its active records and relevant modification history, in CSV and/or PDF where technically supported.

- Cancellation: 30 days’ read-only export access after service expiry, subject to secure identity verification and lawful restrictions; consider a longer period for customers with critical employment records.

- After export window: live Customer Data scheduled for deletion within 30 additional days unless legally required, disputed, or subject to documented preservation instructions.

- Backups: deletion through ordinary backup rotation within \[60–90\] additional days; restoration must not resurrect deleted records into active service without appropriate re-deletion controls.

- Provider account, billing and tax records: retained for their applicable legal or operational purposes, separately documented from employment data.

- Critical safeguard: immediately on cancellation, show explicit prompts to export records subject to Fair Work retention periods; avoid claiming the provider itself must always retain all records for seven years.

- Former workers: Customer manages continued access and record provision; the app must explain how workers contact their employer and request personal information from Provider where relevant.

## Schedule D — Subprocessor register

| Provider | Purpose | Data | Country/region | Overseas access? |
|---|---|---|---|---|
| DigitalOcean | Hosting, database and document storage | All Customer Data and uploaded documents | Sydney, Australia | Possible vendor support access \[CONFIRM\] |
| Zitadel | Sign-in and two-factor authentication | Name, email address, sign-in and security events | Australian region | \[CONFIRM\] |
| Resend | Sending email | Name, email address, message content | \[CONFIRM REGION\] | \[CONFIRM\] |
| ClickSend | Sending text messages | Mobile number, message content | \[CONFIRM REGION\] | \[CONFIRM\] |
| Cloudflare (Turnstile, when switched on) | Stopping automated spam on public forms | IP address and browser signals of people using the form | Global network | Yes |

Messages never contain health information or document numbers. Push notifications for the worker app will be added to this register before the app is released.
