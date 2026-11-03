# David's answers to the "decisions to make" list (3 Nov 2026)

David answered the first eight questions on "CROP: what we need from you for the first milestone" in a Word document on 3 Nov. His screenshots of the original roster design (Steve's, with invented names) were the reference for answers 2 and 3. This note records the answers and what CROP does with them.

## 1. C4U's numbers for the dashboard

Live figures, shown as numbers with percentages. First at company level, then drill down by **state** and by **office**.

- **Shifts:** client requests, shifts filled, unfilled, client cancelled.
- **Allocation officers / internal sales performance:** shifts handled per officer, messages sent, calls made.
- **Personnel (employees):** shifts accepted (not worked yet), shifts worked, pull-outs.

What it means for CROP:
- A real **Office** (branch) is needed: a business has named offices (C4U's are like "VIC Melbourne Metro", "QLD Sunshine Coast"); each site belongs to one office; office staff can be attached to offices. The allocation queue's region chips switch from the site's state to offices, and the dashboard drills down company → state → office.
- "Client cancelled" must be told apart from other cancellations: a cancel reason kind (client cancelled / client withdrew / our error / other) on cancelling.
- "Calls made" needs a quick call log: from the fill panel and a person's card, "Log a call" (who, worker or client, outcome), counted per officer. CROP does not dial; it records.
- "Shifts handled per officer" and "messages sent" come from what CROP already records (who changed each shift; the message log's sender).
- Personnel numbers: per person, shifts accepted and not yet worked, shifts worked (ended, booked), pull-outs; for the business and per office.
- The numbers use the same definitions as the existing dashboard measures (`dashboard/kpis.ts`), so the dashboard, daily email and app agree.

## 2. The grey "T" (Template) on the roster

The **T line shows who normally works that shift**, and whether that person is sick or on leave, so the roster person isn't building a roster from scratch: a template pre-fills as much as possible. In the design there is a **Template tab before Draft** (Template · Draft · Live · History) where templates are created for future use. The roster manager may also copy the previous roster and save it as a template for this week, month, etc.

Ribbon letters (from the design; **each employer can customise them**): A = AM shift (shift letter), N = nurse (the role line), F = female (the person, gender), D = duty (care instructions), V = vehicle (car required, or the car booked), E = equipment (e.g. laptop), T = template roster (who normally works it), **R = request** (see 3).

What it means for CROP:
- Templates and copying exist; covering ("T") exists but is set by hand. Next: when a shift is made from a template or a copied week, it remembers its **usual person** from the template; the T line then shows that person automatically, and "– Sick leave" / "– On leave" when they are away that day (never the leave kind beyond sick/leave wording agreed with Steve), whether or not someone else is on it.
- A **Template tab** on the roster: open a template as a week to edit (add, move, change usual people) before filling a week from it; "Save this week as a template" stays.
- **Customisable marker letters** per business (Settings), defaulting to A/P/N, F/M, D, V, E, I, T, R.

## 3. The "app requests" panel = R (Request)

R is a **request a member of staff makes for a day** in the app, e.g. "I want AM shift please" or "must finish before 14:00". It shows on the roster as the R line and in the app requests panel for the roster person.

What it means for CROP: in the app, the person adds a request for a date (preferred period AM/PM/night, finish by / start after a time, and a short note); the office sees them on the roster (R line on that day's shifts and person row) and in an "App requests" panel, and can mark one done or not possible. Requests guide; they never block (a "finish by" that a shift breaks shows as a warning).

## 4. C4U's clients who aren't on CROP

- Account clients would ideally put their requests in through CROP (the client portal).
- Many will just ring; others email, or use their own software (CASCOM, Shift Match) that CROP must work with.
- C4U's current system has no provision for **non-account customers**, so CROP needs a way for a customer to **register online**, as a once-off or repeat customer.

What it means for CROP: phone and email orders are already typed in by the office (client orders, 2 Nov). Next: a light client portal (a client contact signs in and orders, sees their bookings, confirms bookings), and a public "request staff" page per business where a new customer registers and places a first order, held for the office to accept (and set up as a client). Integrations with CASCOM / Shift Match are later and need their interface details.

## 5. Who may change each field on a person's record

- The person record needs a **tab (settings) saying who can input, change or see each piece of information and each document** held about a person.
- **Never overwrite**: when a document is updated (e.g. a driver's licence), the previous one and its details are kept. Data is defined as discardable or kept on file. Example: previous home addresses must be kept.
- **Addresses:** a person can hold several and nominate which is current, moving between them.
- **Self-service first:** wherever possible the person adds and changes their own information (less admin), with some things needing the employer's sign-off (e.g. a new qualification or certificate).

What it means for CROP: credentials already keep history and need verifying; right to work keeps history. Next: a field-access setting per business (for each personal field and document kind: who can see, who can change: office, the person, both; and whether the person's change needs approval), a kept history for personal details (addresses as a list with one current; old values kept, never overwritten), and the app's "My details" honouring it.

## 6. Which modules C4U switches on at launch

David wasn't sure what was being asked. To re-ask in plainer words: "At go-live, which parts will C4U actually use? Anything not used is hidden, and the privacy assessment only needs to cover what's on." Proposed default for C4U to confirm: roster, allocations and client orders, credentials (including police checks and vaccination records, as a nursing and care agency), right to work, worker app and messages; equipment and items off.

## 7. How long records are kept

David's reference: payroll and tax records at least **7 years** (ATO: PAYG, tax and STP 5 years; Fair Work: wage records, hours, leave and super 7 years). Working default until the lawyer confirms: a person's records kept 7 years after they leave, then deleted or anonymised; the audit log kept 7 years. Documents with no ongoing need (e.g. an applicant who never started) may have a shorter period; to confirm with the lawyer.

## 8. Workers under 18

**Yes, no age limit on the staff app.** Minimum working age differs by state and type of work (e.g. Queensland and Victoria generally 13, NSW no general minimum but schooling and safety rules).

What it means for CROP: no age gate on the app. The person record should hold a date of birth (office-only by default) so CROP can mark under-18s, warn on rules that apply to them (roles or shifts set as 18+, night or late work), and the privacy policy and worker notice need wording on minors' information (lawyer to confirm). CROP's own memory/AI features never store a person's age.
