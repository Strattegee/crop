# Agency connections and agency fill: design for David to approve

Status: **proposal, held for David; **approved to build by David, 29 Oct**; all four questions answered (see the end)** (backlog item 7 says write it up and hold before building, because it crosses tenants). Written 28 Oct 2026 by a scheduled run. Nothing here is built yet.

Sources: the 25 Oct meeting (`2026-10-25-roster-meeting.md`), Steve and David's answers (`2026-10-26-steve-answers.md`, items 7–11), CLAUDE.md (tenancy and security rules).

## What it has to do (as decided)

- An employer (a CROP business) links to agencies that also use CROP, ranks them 1, 2, 3, and when it can't fill a shift presses **Agency fill**.
- The request reaches agency 1 first, then agency 2 is added, then agency 3, on a timer. Defaults per agency (David, 26 Oct): starts within 2 hours → 10 minutes; later the same day → 1 hour; next day or later → 2 hours. The employer can change these and add its own rules.
- The agency sees the request on its allocation screen with its own people who are available and meet **exactly the employer's criteria**. It nominates someone, or offers to several and the first to say yes goes.
- The employer chooses per agency (or per request): **book automatically** or **approve first** (pink "accepted" stage).
- Once booked, the agency worker shows on the employer's roster like anyone else.
- Clients see everything the agency sees about the worker except contracts and agreements, by the client user's role, through a list of document types and who can see each (Steve, item 9).
- A business can be both an employer and an agency (item 7).

## The hard problem: two tenants, one shift

Today every table is fenced by row-level security on `tenant_id = app_tenant_id()`, and the API only ever works inside one tenant (`withTenant`). Agency fill needs a record that two tenants both read and change, and the employer needs to see a little about a person who lives in another tenant. The proposal keeps the fence exactly as it is and adds a narrow, audited bridge.

### Principles

1. **No table gets a policy that lets one tenant read another's rows.** RLS stays `tenant_id = app_tenant_id()` everywhere.
2. **Every cross-tenant step is a `security definer` function** owned by the migration role, named `app_agency_*`, that first checks the caller's tenant is a party to the connection or request (the same pattern as `app_offer_by_link` and `app_platform_*`), then reads or writes only the columns that step needs.
3. **Each side keeps its own copy of what it needs.** The employer's roster never joins into the agency's tables at read time; booking writes a small, fixed snapshot into the employer's tenant. If the connection is ended, the employer keeps its history.
4. **Compliance is decided in the agency's tenant, against the employer's rules**, and only the answer (meets / doesn't meet, with plain reasons) crosses over. Documents never cross unless the document visibility list allows it (later slice).
5. **Every cross-tenant change is logged** in an append-only `agency_events` table on both sides (who, which tenant, what, when).

## Proposed data model

### Connections (both tenants see their own row)

`agency_connections` — one row **per side** for each link, so each tenant reads its own row under normal RLS:

| column | notes |
|---|---|
| `tenant_id` | the side this row belongs to |
| `connection_id` | shared id, same on both rows |
| `side` | `employer` or `agency` |
| `other_tenant_id`, `other_name` | the other business, name copied at link time |
| `status` | `invited` → `active` → `ended` (never deleted) |
| `preference` | employer side only: 1, 2, 3… (unique among active links) |
| `book_mode` | employer side: `automatic` or `approve_first` |
| `escalation` | employer side: jsonb of the timing rules, defaulting to David's three bands |
| `sites` | employer side: which of its sites the agency may fill (null = all) |

Linking: the employer's owner/admin invites an agency by its CROP business slug (or a platform admin links them); the agency's owner/admin accepts. Both steps go through `app_agency_invite(slug)` / `app_agency_accept(connection_id)`, which write both rows. Ending a link (`app_agency_end`) closes open requests as withdrawn.

### Requests (shared record, two copies)

`agency_requests` — employer side, normal RLS: the shift id, the role and criteria snapshot (see below), status `open → nominated → accepted → booked`, or `withdrawn` / `expired`, who it was sent to and when each agency was added (`agency_request_rounds`: connection, `added_at`, `reason` = first / timer / manual).

`agency_inbox` — agency side, normal RLS: one row per request the agency has been sent, with the snapshot it needs to show the request (site name, address, local date and times, role, duties, criteria) and nothing else from the employer's tenant.

The two are kept in step only by the `app_agency_*` functions:

- `app_agency_send(request_id)` (employer): writes inbox rows for the agencies due now.
- The timer: a job in the existing Postgres queue (like the notification dispatcher) calls `app_agency_escalate()` every minute to add the next agency when its time comes. Time bands are worked out from the shift's start in the site's time zone.
- `app_agency_nominate(inbox_id, worker_id)` (agency): checks the agency's own eligibility result (below), then writes the nomination on both sides.
- `app_agency_accept_nomination(request_id)` (employer, for approve-first) and automatic booking call one shared booking step.

### Criteria: matching credentials across two businesses

The employer's rules point at its own credential types; the agency's people hold the agency's credential types. These are different rows in different tenants. Proposal:

- **Match by a shared catalogue code.** Industry templates already give each credential type a fixed name and description, identical across packs (tested). Add a nullable `catalogue_code` to `credential_types` (for example `au.rsa`, `au.ahpra.rn`, `au.white_card`), filled in by the packs. Two businesses' credential types match when their codes match.
- A credential type with no code (one the business made up) can be **mapped by hand** on the connection: the agency says "your 'Ward orientation' = our 'Orientation – St Vincent's'". Stored on the agency side (`agency_credential_maps`).
- A rule the agency can't match is shown to the agency as "Not matched: <name>", and nobody meets it until it is mapped. This is the safe default: never assume someone meets a rule.

The request carries a **criteria snapshot**: the role, each hard and warning rule (catalogue code or name, hard/warning), the shift's duties' rules, and the site's local date. The agency runs the existing `eligibilityForShift`-style checks in its own tenant against that snapshot, plus its own rules for the person (right to work, visa hours, rest, leave, double booking with its other placements). That reuses `compliance.ts` and `eligibility.ts` unchanged, with the rules supplied as data.

### Booking: how an agency worker appears on the employer's roster

`shift_assignments.worker_id` points at the employer's own `workers`. Rather than make it point across tenants, booking creates (or reuses) an **agency person row** in the employer's tenant:

- `workers` gains `agency_connection_id` (null for the employer's own people) and `agency_worker_ref` (the agency's worker id, opaque to the employer). Agency person rows hold only first name, last name, role and the agency's name; no contact details, no documents, no employment terms, no right-to-work record.
- These rows are excluded from the employer's own lists (Workers, bank fill, who-can-work, publishing messages) by default, and shown with an agency tag on the roster.
- The assignment is created with the existing `assignWorker` path, marked `via = 'agency'`, so the shift change log, after-publishing rule and Needs attention all see it. Eligibility on the employer side skips credential checks for agency person rows (the agency has done them against the snapshot) but keeps double booking at that employer and the shift's role.
- Status: automatic → booked (green); approve first → accepted (pink) until the employer approves.

### What the employer sees about the agency worker

First slice: name, role, the agency, and "meets your criteria" yes/no with any warnings in plain words (for example "First aid expires 12 Nov"). Later slice: the document visibility list (Steve item 9): each document type with which employer roles may see it, contracts and agreements never; documents opened through a short-lived signed link issued by an `app_agency_*` function after checking the viewer's role. **Held until the list is agreed.**

## Screens

- Employer: Settings → Agencies (link, rank by dragging, book automatically or approve first, timing, which sites); on the roster's shift panel, **Agency fill** under bank fill, showing which agencies have it, when the next one is added, and nominations to approve.
- Agency: an **Allocations** page: open requests from all its employers, soonest first, each with its ready people (same ranking as candidates: free, fewest hours), Nominate or Offer to several (reuses shift offers and reply links, in the agency's tenant).
- Needs attention: employer gets "Agency fill: no nomination yet, agency 3 added at 14:20"; agency gets "2 requests starting within 2 hours".

## Security review points (why this is held)

- New `security definer` functions that cross tenants. Each must check `app_tenant_id()` is a party, take ids not trust tenant ids from the caller, and be tested with a third tenant that must see nothing.
- Agency person rows put a small amount of one tenant's personal data (name) into another tenant. This is what the business relationship requires, but it should be in the terms of use.
- The opaque `agency_worker_ref` must never be usable on the employer side to reach the agency's data.
- Notifications: agency staff get offers from their own agency's account, never from the employer's.

## Suggested build order (after approval)

1. Connections: tables, invite/accept/end, Settings → Agencies on both sides; credential `catalogue_code` filled by the packs. Isolation tests with three tenants.
2. Requests and the inbox, Agency fill button, the escalation timer, the agency's Allocations page (read-only list).
3. Eligibility against the snapshot on the agency side; nominate; book automatically; agency person rows on the employer roster.
4. Approve first (pink); offering to several agency staff; Needs attention for both sides.
5. Document visibility list (needs the list agreed with Steve).

## Questions for David

1. Is matching credentials by a shared catalogue code, with hand mapping for anything else, the right approach? (Alternative: the employer's rules are copied as text and the agency ticks them off by hand, which is simpler but weaker.)
2. Agency person rows in the employer's tenant (name, role, agency only): acceptable, or should the roster show agency workers only through a live lookup?
3. Who links an employer and an agency: their owners themselves (invite and accept), or only Strattegee from the Platform screen at first?
4. Should agency fill also be possible to agencies **not** on CROP (by email), or CROP agencies only for Release 1?

## David's answers (29 Oct)

All four answered. David gave the go-ahead to build on 29 Oct.

1. **Credential matching is set up when the link is made, not when a shift comes in.** "For the relationship between an agency and an employer to work effectively they need to be set up properly from the beginning. The agency need to understand the requirements and match their pool of staff to them. I think it needs to be checked off prior to shifts being required."
   What this changes: linking gets a setup step. The agency sees the employer's requirements and confirms a match for every one (shared codes suggest matches, and the agency checks them and maps the rest). The link can't take requests until every requirement is matched. The agency can see which of its people meet this employer's requirements before any shift arrives. If the employer adds or changes a requirement later, the agency is asked to match it again.
2. **Documents can be shared, by agreement.** "The issue here is compliance, there will be documentation required at times by the employer, I think there should be an option to select on documents that allow them to be shared. This would be decided between the agency and the employer."
   What this changes: each link has a list of document types (per credential type) that the agency agrees to share with that employer. The employer opens shared documents for agency workers booked on its shifts through short-lived links issued after a check. Contracts and agreements are never shared (Steve, item 9). The employer still keeps only name, role and agency in its own records; documents are always read from the agency's side, never copied.
3. **Self-service linking from the start.** "I think it should be self service from the beginning, a shared link by the employer as they are giving access to shifts required. This should be confirmed by the agency."
   What this changes: the employer's owner or admin creates an invitation link (one-off, expiring, only its hash stored, like offer links) and sends it to the agency. The agency's owner or admin opens it while signed in to CROP and confirms; the link is active only after that (and after the matching in answer 1). Either side can end it. Every step is logged.
4. **Agencies not on CROP get an email listing the requirements; they reply outside CROP (Release 1).** "If employers need staff and are using non crop agencies, the agency should be sent an email that lists all requirements. All standard requirements for the position are noted with a section of special requirements if any. The email should also note on each requirement what is optional or ideal." On how they reply, David chose option 1: the agency replies by email or phone as now, and the office adds the person to the shift by name, marked as an unchecked agency worker. A reply link (the agency puts someone forward and ticks each must-have) can come later.
   What this changes: the employer can keep non-CROP agencies (name, email) on its agency list. Agency fill emails them the shift (site, local date and times, role, area) and its requirements in sections: standard requirements for the role (from role rules) and special requirements for this shift (from its duties), each marked "Must have", "Ideal" (today's warning level) or "Optional" (a new third level: listed, never checked or warned about; see the backlog's requirement levels item). The email contains no people's names or private details. An unchecked agency worker on the roster is clearly labelled, and CROP doesn't check their credentials.
