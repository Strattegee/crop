# Run log

Newest first. One entry per working session or scheduled run.

## 2026-10-26 afternoon (scheduled run)

- Shipped: availability and leave, first part (backlog item 10). The office can record when each person usually can work (by day, and morning, afternoon or night), one-off changes for a date ("can't do Saturday"), and leave in whole days. Approved leave stops someone being put on a shift or offered one that day; asked-for leave and "not available" show as warnings, so the office can still roster someone after a phone call. The "who can work this shift" and bank-fill lists now put people who are free first. When leave is recorded or approved, CROP lists the shifts the person is already on, so cover can be found. Only owners and admins approve leave. The type of leave is never shown in reasons or messages.
- Chose item 10 over the roster screen (item 2) because David's session was working on the roster screen an hour earlier; this run left the screen alone to avoid clashing.
- Still to do on item 10: screens (availability on a person's page, leave to approve, leave lines on the roster) and staff entering their own (worker app).
- Next: roster day and month views and Draft → Live (item 2), or the availability and leave screens if David's session has the roster in hand.
- Waiting on David: nothing new.

## 2026-10-26 (scheduled run, after lunch)

- Shipped: reply links for shift offers (backlog item 6, as David decided this morning). When the office offers a shift, each person's email and text now include their own link. Opening it shows the shift and two buttons, Accept shift and No thanks; no sign-in. The first to accept is booked, with the same checks as the office (no double booking, still qualified); everyone else's offer closes. Links stop working once the offer is filled, withdrawn, declined or expired, only a scrambled copy is stored, and the page shows the person's first name and the shift only. The roster's side panel now lists who said no and whether they used the link.
- Next: roster day and month views, and draft → publish (item 2); then availability and leave (item 10).
- Waiting on David: nothing new. Note: with the link, an offer text is often two SMS parts (costs twice); a short-link service would fix that but costs money, so it's his call.

## 2026-10-26 late morning (with David)

- Shipped: café demo (15 roles, credential library, 32 invented staff, equipment, stock, a week of shifts); industry templates for 7 industries in Settings; staging-only demo staff per template, credential top-up and fill-open-shifts buttons. Demo staff now meet a business's own rules (e.g. a police check for everyone), which had left the first café demo unfillable.
- Next: offer links without sign-in (item 6).

## 2026-10-26 morning (with David)

- David cleared the roster screen (Steve endorsed the concept) and agreed staff may accept offers from a single-use link without signing in.
- Shipped: the roster screen, first version (week by area or person, open shifts, equipment rows, hours, add shifts, assign, bank fill, equipment booking, cancel).
- Note: earlier scheduled-run entries labelled "26 Oct evening" and "26 Oct" ran overnight 25–26 Oct (Melbourne time).
- Next: offer links without sign-in (item 6), then roster day/month views and publishing (item 2).

## 2026-10-26 evening (scheduled run)

- Shipped: bank fill, first part (backlog item 6). For an open shift, the office gets a list of its own bank and casual staff who can work it (ready first, fewest hours that week first). It can offer the shift to several people at once; each gets an email and a text with the shift's details. The office records who said yes or no, and the first to say yes is booked; everyone else's offer closes and they get an email saying it's filled. Two people saying yes at the same moment, or one person taking two overlapping shifts, can't both go through. Offers can have a time limit, and they close if the shift is filled another way or cancelled.
- Still to do on item 6: staff replying for themselves (worker app or a reply link), availability, and the office screen.
- Next: availability and leave (item 10) so bank fill only shows people who are free, unless David clears the roster screen (item 2).
- Waiting on David: confirm whether the 25 Oct meeting with Steve counts as the Ribbon roster review; decide whether staff may accept offers from a link in the message without signing in.

## 2026-10-26 (scheduled run)

- Shipped: items and consumables, first part (backlog item 5). The business can keep a list of things it hands out or uses up (gloves, hi-vis, fuel, sundries) with what each costs and, if it's charged on, what the client pays. Stock is counted at each site: deliveries in, items issued to a person or used on a shift, returns, and stocktakes. It won't hand out more than a site has, and flags low stock. Each shift shows what it used, what that cost and what can be charged to the client; each person shows what they've been issued and not returned. Fuel bought on a card can be recorded against a shift without counting stock.
- Still to do on item 5: moving stock between sites, and office screens.
- Next: bank fill (item 6), unless David clears the roster screen (item 2).
- Waiting on David: confirm whether the 25 Oct meeting with Steve counts as the Ribbon roster review.

## 2026-10-26 morning (scheduled run)

- Shipped: equipment booked on its own, without a person (backlog item 4). A shift can now be marked "equipment only", for example a machine dry-hired to a client who brings their own operator. Nobody can be put on it, the licensed-operator rule doesn't apply, and it shows as booked once equipment is on it (open again if everything is removed). The machine still can't be in two places at once. Wet hire stays an ordinary shift with a person and the machine.
- Still to do on item 4: hire rates and which client a hire is for (comes with clients and invoicing), and equipment on the roster screen.
- Next: items and consumables (item 5), unless David clears the roster screen (item 2).
- Waiting on David: confirm whether the 25 Oct meeting with Steve counts as the Ribbon roster review.

## 2026-10-26 early morning (scheduled run)

- Shipped: equipment dates in the office's daily compliance email (backlog item 4). Registration, service and inspection dates now appear 30 days before, on the day and once overdue, alongside people's expiring credentials, and each line says how many upcoming shifts the machine is booked on after that date. Retired equipment and replaced dates are left out.
- Fixed: recording right to work refused today's date as the VEVO check date on Australian mornings (the check used the server's UTC date). It now uses the business's own date. This was also making the automatic checks fail before 11am Melbourne time.
- Next: rest of item 4 (wet vs dry hire, equipment booked without a person), then items and consumables (item 5), unless David clears the roster screen (item 2).
- Waiting on David: confirm whether the 25 Oct meeting with Steve counts as the Ribbon roster review.

## 2026-10-25 late night (scheduled run)

- Shipped: equipment on the roster, first part (backlog item 4). The business can keep a register of its machines, vehicles and tools, record the dates each must be current for (registration, service, inspection), and book equipment to shifts. Booking is refused when the equipment is out of service, a date will be overdue on the shift date, it's already booked at that time, or the person on the shift doesn't hold the licence needed to operate it (and a person without that licence can't be put on a shift that has the machine). The roster now shows equipment rows with hours booked.
- Still to do on item 4: reminders for equipment dates, wet vs dry hire, and equipment on the roster screen.
- Next: items and consumables (item 5), unless David clears the roster screen (item 2).
- Waiting on David: confirm whether the 25 Oct meeting with Steve counts as the Ribbon roster review, so runs can build the roster screen.

## 2026-10-25 night (scheduled run)

- Shipped: eligibility when assigning (backlog item 3). The roster now refuses to put someone on a shift if they don't have the role, a required credential or right to work won't be current on the shift date, they're already rostered then, or it would take a visa holder over their fortnightly hours. It warns about short rest between shifts (10 hours by default, changeable) and credentials expiring soon. New "who can work this shift" list, ready people first.
- Skipped item 2 (roster screen) for now: the working-alone rules hold Ribbon roster design for Steve's review, so it waits for David to confirm.
- Next: equipment on the roster (item 4) unless David clears the roster screen.

## 2026-10-25 evening (with David)

- Shipped: employer roster foundations — employment terms (full-time, part-time, casual, bank; contracted hours), shift codes, shifts (single or blocks across weekdays, overnight shifts, site time zones), assigning people with double-booking blocked, confirm, unassign, cancel, and a roster endpoint with hours per person. Website rewritten to lead with employers.
- Next: roster screen (backlog item 2).

## 2026-10-25 afternoon (with David, after meeting Steve)

- Changed direction: CROP is first an employer roster; agencies fill shifts through an allocation screen when employers press Agency fill. Backlog reordered; decisions and open questions in `docs/decisions/2026-10-25-roster-meeting.md`.
- Next: employer roster foundations (backlog item 1).

## 2026-10-25 (with David)

- Shipped: document preview on hover; add-credential form shows the right fields per type; clearer Messages test buttons; expiry reminders (CRD-7); notification service and Messages page.
- Decided: CROP is multi-industry (packs: healthcare, labour hire, construction, hospitality); CFY's first release centres on shift filling, not the Ribbon roster; scheduled runs work alone with the approval rules in `docs/WORKING-ALONE.md`.
- Next: shifts and shift requests (backlog item 1).
- Waiting: ClickSend number (Mon), Steve's roster review.


## 26 Oct, afternoon (interactive)
- Words and codes: numbered concepts and screens, per-business words, Settings editor; templates suggest words. Checked locally end to end.
- David: "the ribbon seems to be missing". Asked which part of the full-screen design he means (likely the left people strip); not started.
- Ribbon: David confirmed the ribbon is the coloured stage line (booked/assigned/cancelled). Built it plus the left people strip with drag to assign.
- Platform screen (add businesses, give/change/remove access, audit log) and "Business" instead of "Agency" in the switcher. Standing principle written into WORKING-ALONE.md: finish, then take the next item. Questions for David and Steve listed in the backlog.
