# Run log

Newest first. One entry per working session or scheduled run.

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
