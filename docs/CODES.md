# CROP codes

Steve and David, 26 Oct 2026: every concept and every screen has a fixed number. Users never see the numbers.
Each business picks its own words for the concepts (one set per business, Settings → Words we use), so a
nursing agency can say "Staff member" and "Facility" while a builder says "Crew" and "Project". Code,
reports, permissions and support refer to the number, never the word, so renaming can't break anything.
This avoids the problem Entire had when "members" was baked into the product.

## Term codes (1000–1999): concepts the business can rename

Source of truth: `apps/api/src/terms/terms.ts` (`TERMS`). Table `business_terms` holds only the words a business has changed.
The first industry template applied suggests words (`PACK_TERMS`); it never overwrites words the business already has.

| Code | Concept | Standard word |
|---|---|---|
| 1010 | A person who works shifts | Worker / Workers |
| 1015 | A business the work is done for | Client / Clients |
| 1020 | A place where work happens | Site / Sites |
| 1030 | A part of a site, or a team | Area / Areas |
| 1040 | A unit of work at a time and place | Shift / Shifts |
| 1045 | The plan of who works when | Roster / Rosters |
| 1050 | Proof someone is qualified or cleared | Credential / Credentials |
| 1055 | A job someone can do | Role / Roles |
| 1060 | Machines, vehicles and tools | Equipment / Equipment |
| 1070 | Things issued or used up | Item / Items |
| 1080 | The pool of relief staff | Bank / Bank |
| 1090 | An outside supplier of staff | Agency / Agencies |

Add new concepts as they come up: next free code in the right range, add to `TERMS`, and to `PACK_TERMS` where an industry has its own word. Never reuse or renumber a code.

## Function codes (1000–9999): screens

Source of truth: `apps/web/lib/functions.ts` (`FUNCTIONS`). The menu carries the code as `data-fn`. Later: permissions per function, support ("which screen?"), and usage reports.

| Code | Screen | Label |
|---|---|---|
| 1000 | Dashboard | Dashboard |
| 2000 | Roster | term 1045 |
| 2100 | Bank fill (roster side panel) | term 1080 + "fill" (reserved) |
| 2200 | Agency fill / allocation (reserved) | |
| 3000 | Workers | term 1010 |
| 3500 | Compliance | Compliance |
| 4000 | Clients | term 1015 |
| 4100 | Sites | term 1020 |
| 5000 | Equipment (reserved) | term 1060 |
| 5500 | Items (reserved) | term 1070 |
| 6000 | Messages | Messages |
| 9000 | Settings | Settings |
| 9100 | Shift types (under Settings, not in the menu) | Shift types |
| 9110 | Shift duties (under Settings, not in the menu) | Shift duties |
| 9120 | Cover rules (under Settings, not in the menu) | Cover rules |
| 9130 | Onboarding checklists (under Settings, not in the menu) | Onboarding checklists |
| 9140 | Agencies: links with agencies and the businesses we supply (under Settings, not in the menu) | the business's word for Agencies |

## Still to do
- Use the words in more places: roster labels and panels, form labels, API error messages, notification text, the worker app.
