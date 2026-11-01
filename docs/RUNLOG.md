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
- Roster: A/P/N letters on every shift, leave lines (on leave / leave requested), Day totals row. Café opening shift code renamed OPEN → EARLY (read like the Open stage).
- Availability and leave screens: usual week, date changes and leave on the person's page; Leave page to approve, decline or cancel; tells the office how many shifts need cover.
- ClickSend: David bought the dedicated number (+61429804977); set as the staging sender in compose.yml.
- Demo people's @example.com emails are now skipped (logged) instead of failing at Resend. SMS waits for David to add the ClickSend username and API key on the server.
- Equipment and Items pages: the register with dates and status, and stock per site with receive, issue and stocktake.
- Ribbon colours to Steve's scheme (unfilled grey, offered pale yellow, allocated darker yellow, pulled out purple, booked green, cancelled red; pink reserved for approve-first). "They pulled out" button on the shift panel.
- Welcome emails from the Platform screen (with the sign-in link and their role), logged in the business's Messages.

## 2026-10-26 evening (scheduled run)

- Shipped: shift types (Steve's answer 4; backlog item 2). Each business now sets its own usual shifts on Settings → Shift types: a letter (for example D, or AM / PM / NS on a ward), a name and the standard hours and break. Owners and admins can add, change and switch them off. The letter shows on every shift on the roster; shifts without one still show A, P or N from the start time. Changing the hours only affects shifts added afterwards. Industry templates now come with letters.
- Next: the rest of the roster screen (item 2): Draft / Live / History with a change log, then day and month views, then roster templates.
- Waiting on David: nothing new.


## 2026-10-26 night (scheduled run)

- Shipped: Draft / Live / History on the roster (backlog item 2, Steve's answer 5). Each site's week starts as a draft; pressing Publish week makes it live, and once the week is over it becomes history. Every change to a shift (added, someone put on, confirmed, taken off, pulled out, cancelled, equipment booked or removed, notes) is now recorded with who did it and when, and changes made after publishing are marked. The roster shows "3 changes since" with a Publish changes button, a Changes list for the week, and a History list on each shift. Publishing doesn't send staff any messages yet.
- Next: the rest of item 2: day and month views, then roster templates (Steve's "ideal week"), then the after-publishing settings (approved changes, lock).
- Question added for David and Steve: should publishing a week message staff their shifts, and should they hear about later changes?
- Waiting on David: nothing new.

## 2026-10-27 early morning (scheduled run)

- Shipped: Day and month views of the roster (backlog item 2). A Day / Week / Month switch sits next to the arrows. Day shows one day hour by hour: each shift is a bar from its start to its finish (night shifts run past midnight, overlapping shifts stack), with the same side panel and drag and drop as the week. Month is a calendar: each day shows how many shifts are filled, the hours, how many are still open and who's on leave, and each week shows whether it's draft, live or history. Clicking a day opens it; clicking a week opens the week. Day headings in the week view now open that day too.
- Next: roster templates (Steve's "ideal week": save a week as a template, apply it, or copy the previous week), then the after-publishing settings.
- Waiting on David: nothing new (still the question about messaging staff when a week is published).

## 2026-10-27 morning (scheduled run)

- Merged the day and month views left open by the previous run (CI was green; staging deploy succeeded).
- Shipped: roster templates and copying a week (backlog item 2, Steve's "ideal week"). On the roster, "Templates and copying" lets the office save a site's week as a template, fill any week from a template, or copy last week (or any week). Each shift gets its usual person where they can work it (waiting for them to confirm); anyone who can't (on leave, already rostered, missing a credential) leaves the shift open and the office is told why. A week that already has shifts isn't doubled unless the office ticks "Add to the shifts already there", and weeks that are over can't be filled. Shift times stay the same across the daylight saving change.
- Next: the after-publishing settings (approved changes, lock), then a screen for employment terms; carrying equipment over with a template later.
- Waiting on David: nothing new (still the question about messaging staff when a week is published).

## 2026-10-27 late morning (scheduled run)

- Shipped: what can change after a roster is published (backlog item 2, Steve's answer 5). Settings now has "After a week's roster is published" with three choices: anyone in the office can change it (as before), only owners and admins, or nobody until it's turned back on. Every way of changing a shift follows it (adding, putting someone on, taking them off, cancelling, equipment, notes, templates, offers). Staff can still accept an offer by its link unless changes are turned off. The roster says which rule applies on a live week, and refusals say why in plain words.
- Also: Settings heading now says "Business settings" instead of "Agency settings".
- Next: requesting and approving a change (so allocators can ask when only owners and admins can change a live week), then a screen for employment terms.
- Waiting on David: nothing new (still the question about messaging staff when a week is published).

## 2026-10-27 night (scheduled run)

- Shipped: asking for a change to a published roster, and approving it (backlog item 2, Steve's answer 5). When the business has set "only owners and admins can change a live week", anyone else who opens a shift on that week now sees "Ask for a change" instead of the buttons: put someone on, they've agreed, take them off, they pulled out, cancel the shift, or something else in their own words. The roster shows the changes waiting for approval; an owner or admin presses Approve (the change is made straight away, as theirs, with the usual checks, and shows in the change log) or Decline with a reason. The person who asked can withdraw it. If the change can't be made any more (for example someone else was put on the shift meanwhile), approving says why and nothing changes.
- Also shipped: an Employment card on each person's page. It shows whether they're full-time, part-time, casual or bank and their hours a week, any change starting later, and the history. Owners and admins set new terms from a date (earlier weeks keep what applied then). Adding a worker can now set their employment straight away. The roster's hours-against-contract column uses it.
- Next: emails to owners and admins when a change request arrives, then carrying equipment over with a template or copied week.
- Waiting on David: nothing new (still the question about messaging staff when a week is published).

## 2026-10-27 midday (scheduled run)

- Shipped: emails about change requests (backlog item 2). When someone asks for a change to a published roster, every owner and admin now gets an email saying who asked, which shift and what change, with a link that opens the shift on the roster. When an owner or admin approves or declines it (or withdraws it for them), the person who asked gets an email with the outcome and any note. Nobody is emailed about something they did themselves. Demo people with example addresses are logged, not emailed, as before.
- Also shipped: equipment in roster templates and copied weeks. Saving a template now remembers the equipment on each shift, and filling a week from a template or copying a week books the same equipment again where it can be (in service, its dates current, not booked elsewhere, an operator who holds the licence). Anything that can't be booked is left off, and the office is told which and why. Each of the three forms has a tick box to leave equipment out.
- Next: duplicating a whole month, then the needs-attention list or shift duties.
- Waiting on David: nothing new (still the question about messaging staff when a week is published).

## 2026-10-27 afternoon (scheduled run)

- Shipped: copying a whole month (backlog item 2, the last piece of templates and copying). The month view now has "Copy this month": it copies the four or five weeks starting in that month into the same number of weeks from a date the office picks (straight after by default), on the same weekdays and times, with the same people and equipment wherever they can still work or be booked; anything that can't is left off and the office is told why. It's all or nothing: if any week being copied into is over or already has shifts, nothing is copied (unless "Add to the shifts already there" is ticked). Empty weeks are skipped and named.
- Next: the needs-attention list (open shifts starting soon, offers with no reply, compliance problems on booked shifts), then shift duties.
- Waiting on David: nothing new (still the question about messaging staff when a week is published).

## 27 Oct, evening (with David)
- David and Steve: yes, publishing should tell staff. Built: Publish week emails and texts each person their shifts; publishing changes tells only the people affected (including anyone taken off). "Tell staff" tick box to publish quietly.
- Zitadel codes now arrive (David). ClickSend keys: David adding them on the server.
- SMS live on staging: David added the ClickSend keys (the API username differed from the login email; a shell-exported old value briefly overrode the new one). Test text received.
- International (David and Steve): order AU, NZ, US, UK. Built: country and time zone per business and per site, with each country's regions and postcodes. The rest listed under International in the backlog.

## 2026-10-27 evening (scheduled run)

- Left alone: the international (countries and time zones) pull request, opened by David's session as this run started (merged during the run).
- Shipped: a Needs attention panel at the top of the roster (backlog item 12, first slice). It looks at the next seven days, whatever week is on screen, and lists: shifts nobody is on (and whether they've been offered, are waiting on replies, or the offers ran out), people who haven't confirmed their shift, and people or equipment booked on a shift who can no longer work it (a licence or right to work runs out by then, leave approved since they were booked, a machine out of service or overdue for a check). Anything starting within a day comes first and opens the panel; each line opens that shift on the roster.
- Next: Cards / Detailed / Simple roster views, or shift duties.
- Waiting on David: nothing new.

## 27 Oct, evening (David's request)
- Roster: the day headings now stay at the top while scrolling through shifts. The grid scrolls inside its own box, as tall as the window (a box that only scrolled sideways stopped the headings sticking).
- Roster: Needs attention can be closed and opened from its heading (an arrow and Show / Hide), and stays as the office left it in that browser. It still opens by itself when something starts within a day, unless it was closed.

## 27 Oct, evening (with David)
- David added the "Merge Claude's pull requests" workflow: pull requests labelled `claude-automerge` are merged by GitHub once CI passes, then staging is deployed. Runs add the label only to work they may ship without asking (docs/WORKING-ALONE.md, step 4), so they no longer wait for David to merge.

## 2026-10-27 night, 10pm Melbourne (scheduled run)

- Shipped: Cards / Detailed / Simple on the roster's week view (backlog item 2, from Steve's design). A new switch next to By area / By person. Detailed adds to each card the role (or the area when viewing by person), the paid hours, who pulled out, why a shift was cancelled, and the shift's notes. Simple shows each shift on one line (the shift letter and who's on it, or the role while it's unfilled, and +1 for equipment), still coloured by stage, so a busy week fits on one screen. The choice stays as you move between weeks and sites. Day and month views stay as they were.
- Also shipped: shift duties (first slice). Settings now has "Shift duties": a business lists things a shift can involve, such as "Serves alcohol" or "Food safety supervisor", and what each needs (for example an RSA, must have or should have). In the roster's shift panel the office ticks the duties for that shift, and the cards show them. Whoever works the shift must also meet its duties, so someone whose RSA has run out can still work a shift with no bar service, but can't be put on one that serves alcohol (the reason says so). Adding a duty to a shift someone is already on tells the office if they no longer meet it. Duty changes appear in the shift's history and follow the after-publishing setting; templates and copied weeks keep the duties.
- Next: duties in the industry templates and when adding shifts, the "one food safety supervisor on every shift" site rule, then a Needs attention count on the Dashboard.
- Waiting on David: nothing new.

## 2026-10-28 early morning, 12:20am Melbourne (scheduled run)

- Shipped: shift duties in the industry templates and when adding shifts (next slice of shift duties). Each industry template now brings the duties that business usually needs, with the credentials each one requires: for example a café gets "Serves alcohol" (needs an RSA), "Food safety supervisor", "Handles food" and "First aid officer"; construction gets "Works at heights", "Confined space work" and "Asbestos area". A duty the business already has under the same name is left as it is. On the roster, the Add shifts form now has a Duties tick list, so a block of bar shifts can be made with "Serves alcohol" on every one in one go.
- Next: the "at least one food safety supervisor on every shift" site rule, then a Needs attention count on the Dashboard.
- Waiting on David: nothing new.

## 2026-10-28 early morning, 3:15am Melbourne (scheduled run)

- Shipped: cover rules (the last planned piece of shift duties). Settings now has "Cover rules": a business can say that someone on shift must hold a credential whenever anyone is working, at one site or every site (for example a food safety supervisor). Because the rule is met by everyone on shift together, it never stops the office putting someone on a shift; instead the roster's day and week views list the cover gaps ("Nobody with a Food safety supervisor working 15:30–20:00") and Needs attention shows those coming up in the next week. Only checked credentials that haven't run out count.
- Next: a Needs attention count on the Dashboard, then transfers of items between sites.
- Waiting on David: nothing new.

## 2026-10-28 morning, 6:10am Melbourne (scheduled run)

- Shipped: the Dashboard is now roster-first (Needs attention, last planned piece for the employer). It opens with Needs attention for the coming week: how many things, how many start within a day, a count of each kind ("3 shifts with nobody on them", "1 person yet to confirm", cover gaps…) and the five most pressing, each opening its shift on the roster. Below that, what's waiting on a decision (leave requests, roster change requests, credentials to check), then people and sites. It uses each business's own words and no longer talks about "your agency".
- Also shipped: moving stock between sites. On the Items page, each counted item now has "Move from … to …": pick the site it leaves (with how many it has), the site it goes to, and how many. It's refused if the first site doesn't have enough. Both sites' stock updates at once and the move is kept in the item's history like every other movement.
- Next: correcting a mistaken employment entry, then the employment type on the Workers list.
- Waiting on David: nothing new.

## 2026-10-28 morning, 9:10am Melbourne (scheduled run)

- Shipped: correcting a mistaken employment entry. On a person's page, the Employment card has "Correct a mistake": fix the type or hours of any entry; for the latest entry, also change the date it starts (the entry before it then ends the day before), or withdraw it if it was added by mistake, so the one before carries on. Nothing is overwritten: the old entry stays in History, struck through and marked corrected or withdrawn. The roster, bank fill and eligibility ignore corrected entries.
- Also shipped: the Workers list shows how each person is employed today (full-time, part-time, casual or bank, with hours a week) and has an Employment filter, including "Not recorded".
- Next: start and end of employment on the employment record, or duties in the café demo.
- Waiting on David: nothing new.

## 2026-10-28 morning, 9:30am Melbourne (scheduled run, second piece)

- Shipped: the café demo now shows shift duties and cover rules. Its evening shifts (duty manager and waitstaff closing) carry "Serves alcohol", which needs an RSA, so Alex, whose RSA has run out, can work days but not the bar. The café also has a rule that a food safety supervisor must be on whenever anyone is working: the head chef and manager cover weekdays, and the late and weekend shifts show up as cover gaps on the roster and in Needs attention.
- Next: start and end of employment on the employment record.
- Waiting on David: nothing new.

## 2026-10-28 midday, 12:15pm Melbourne (scheduled run)

- Shipped: end of employment. On a person's page, the Employment card has "End employment": the last day of work and a reason (resigned, contract ended, terminated, retired, other). After that day they can't be put on a shift (the reason says their employment ended on that date) and they drop off the roster and the lists of who can work. Shifts they're still on after their last day stay put, and the office is told how many need someone else (they also show in Needs attention). A mistake can be undone (kept in History). If someone comes back later, new terms from their return date start a new spell and the old one stays ended. The card shows "Employed since …", and the Workers list shows "Left <date>" with a "Has left" filter.
- Next: the agency connections design write-up (to hold for David), or words in roster labels and forms.
- Waiting on David: nothing new.

## 2026-10-28 afternoon, 3:20pm Melbourne (scheduled run)

- Shipped: items on the roster. The shift panel now has an Items section: what the shift used and what the person on it was given for it, with the cost and the charge to the client and a total, and a Return button on each line. "Add to shift" picks an item (it says how many the shift's site has, and greys out ones it has none of), how many, and whether it goes to the person on the shift or is used on the shift itself. It shows on published weeks too, because handing out gloves isn't a roster change.
- Also written: the design for agency connections and agency fill (how an employer and an agency link up, how a request escalates from agency 1 to 2 to 3, how an agency's people are checked against the employer's rules without either business seeing the other's records, and how a booked agency worker appears on the employer's roster). It is in `docs/decisions/2026-10-28-agency-connections-design.md` with four questions. Nothing of it is built.
- Next: words in roster labels and forms (backlog), or the worker app once its sign-in is confirmed.
- Waiting on David: approval of the agency connections design and its four questions.

## 2026-10-28 evening, 6:30pm Melbourne (scheduled run)

- Shipped: onboarding checklists (first slice of recruitment and onboarding, backlog item 11). Settings now has "Onboarding checklists": a business lists what a new person needs before they can work, in order, each step required or optional. Some steps are tasks the office ticks (contract signed, induction done); others tick themselves when the person's record is complete (a credential checked and current, right to work checked, employment terms set). "Start from our credential rules" builds a checklist from the credentials the business already requires. When adding a person the office can pick a checklist; they then stay off the roster until an owner or admin presses "Finish onboarding and make active", which only works once every required step is done. The person's page shows the progress and each step in plain words ("Recorded, waiting to be checked"), and the Dashboard shows who is being onboarded and who is ready to finish. Onboarding can also be stopped with a reason.
- Next: words in roster labels and forms, or requesting documents by email as part of onboarding. Applying online (a public form) is held for David because it opens CROP to the public.
- Waiting on David: approval of the agency connections design and its four questions (unchanged). The worker app is the next big item; its sign-in setup in Zitadel still needs David to confirm the app's client ID.


## 2026-10-28 night, 9:15pm Melbourne (scheduled run)

- Shipped: asking a new person for what's still needed (onboarding). On a person's page, the Onboarding card has "Ask <name> for what's still needed": it emails them (and texts them, if ticked) a plain list of the credentials and right to work details still missing, with an optional note from the office ("Bring them in on Monday"). Anything already recorded and waiting to be checked isn't asked for again, and vaccinations are only ever "a vaccination record". Pressing it twice by mistake doesn't send twice, and the card shows when they were last asked.
- Next: words in roster labels and forms, or the worker app once its sign-in is confirmed.
- Waiting on David: approval of the agency connections design and its four questions (unchanged); the worker app's client ID in Zitadel; applying online and uploading documents through a link (both open CROP to the public, so held).

## 2026-10-29 early morning, 12:40am Melbourne (scheduled run)

- Shipped: the roster speaks each business's own words. Every label and form on the roster and its side strip now uses the words chosen in Settings → Words we use: a café that calls its people Staff, its sites Venues and its shifts Jobs sees "Open jobs", "Add jobs", "All venues", "By staff member", "Cancel job", and so on. Also, the roster's "today" and the times it shows (when a week was published, when a change was asked for or made) now follow the business's own time zone instead of always Melbourne, as does the Messages page, which also names onboarding requests and no longer says "your agency".
- Also shipped: the roster's confirmation messages ("Jobs added.", "Job cancelled.", "Published… 3 messages sent to staff with their jobs.") use the same words.
- Next: the same words in API errors and notifications, or the worker app once its sign-in is confirmed.
- Waiting on David: approval of the agency connections design and its four questions (unchanged); the worker app's client ID in Zitadel; applying online and uploading documents through a link (both open CROP to the public, so held).

## 2026-10-29 early morning, 3:15am Melbourne (scheduled run)

- Shipped: messages to staff use the business's own words. Shift offers, "you're booked", "it's been filled", the email and text people get when a week's roster is published, and the credential expiry reminder now say what the business calls things: a café that calls shifts Jobs and its roster a Schedule sends "Demo Cafe has a job for you" and "Your jobs at Harbour Kitchen for the week of …". The office's daily email does the same ("booked on 2 jobs after that date"). Businesses that haven't chosen words get exactly the messages they had before.
- Next: the same words in the remaining error messages, or the worker app once its sign-in is confirmed.
- Waiting on David: approval of the agency connections design and its four questions (unchanged); the worker app's client ID in Zitadel; applying online and uploading documents through a link (both open CROP to the public, so held).
- Also shipped: the same words in roster change requests (what was asked, why it can't be asked, and the emails to owners and admins and back to the person who asked), and on the page staff open from an offer link ("Hi Ana, would you like this job?", "Accept job"), including the replies it gives.

## 2026-10-29 morning, 6:15am Melbourne (scheduled run)

- Shipped: Steve's covering line. In a shift's panel on the roster, "Covering" picks the person the shift is covering, with the people away that day listed first (on leave, then leave requested). The card then shows "Covering Sandra Example" under the person working it. It never says why they're away (the kind of leave stays private). Setting or clearing it shows in the shift's history and the week's changes, follows the business's rule for changing a published week, and doesn't message anyone; if the person being covered is put back on the shift, the line clears.
- Also shipped: who issued a credential. Adding a credential on a person's page has an optional "Issued by" (the licensing body or training provider), shown under the number; changing it on a checked credential sends it back for checking.
- Next: an edit form for credentials on the person's page, or requirement levels (recorded but never warns), or the worker app once its sign-in is confirmed.
- Waiting on David: approval of the agency connections design and its four questions (unchanged); the worker app's client ID in Zitadel; applying online and uploading documents through a link (both open CROP to the public, so held). New question for Steve: is "Covering <name>" enough without the reason?

## 2026-10-29 morning, 9:10am Melbourne (scheduled run)

- Shipped: correcting a credential. Each credential on a person's page now has Edit: number, who issued it, dates and notes, with the same required fields as adding. If a checked credential gets a new number, issuer or dates, the page says it needs checking again before it counts; saving without changing anything leaves it (and its history) alone. Notes now show under the credential's name.
- Next: requirement levels (recorded but never warns), or the worker app once its sign-in is confirmed.
- Waiting on David: approval of the agency connections design and its four questions (unchanged); the worker app's client ID in Zitadel; applying online and uploading documents through a link (both open CROP to the public, so held).

## 2026-10-29 midday, 12:15pm Melbourne (scheduled run)

- Shipped: optional requirements. Besides "must have" (blocks) and "should have" (a warning), a credential can now be marked "Optional" in Settings → Who needs what and on a shift duty. Optional ones are listed on the person's page ("has one" / "not recorded") so everyone can see they're useful, but they never stop anyone working, never warn, and aren't added to onboarding checklists. Industry templates can carry them too. This is the third level David's agency emails use (must have / ideal / optional).
- Not started: agency connections. David approved the design this morning and his own session may be building it, so this run left it alone to avoid two sessions on the same piece.
- Next: agency connections (connections and credential matching first), uploading documents through a link (also approved today), or the worker app's sign-in (its client ID was confirmed today).
- Waiting on David: the public apply form (spam protection and the form's questions).


## 2026-10-29 midday, 12:30pm Melbourne (session with David)

- Shipped: the legal documents David supplied are on staging at /legal: privacy policy, worker privacy notice, subscription agreement, data processing agreement, acceptable use policy, and the service level, security and data schedules. Gaps still to fill are highlighted. The home page and shift offer page link to Privacy and Legal.
- Changed for accuracy, for the lawyer to check: the pack said CROP wouldn't hold health information or background checks, but credentials can include vaccination records and police checks, and right to work holds visa details; the privacy policy and DPA now say so. The subprocessor register lists DigitalOcean, Zitadel, Resend, ClickSend and (when switched on) Cloudflare.
- Waiting on David: ABN, address, contact emails and effective date for the documents; the apply form's questions.
- Also (David's request): clicking a Needs attention entry, on the roster or the Dashboard, now opens that shift in a new tab, scrolled to its panel, so the office can open several, fix each and close the tab.

## 2026-10-29 afternoon, 3:30pm Melbourne (scheduled run)

- Shipped: linking with agencies (first slice of agency connections, approved by David this morning). Settings → Agencies: an owner or admin makes an invitation link and sends it to the agency; the agency's owner or admin opens it while signed in to CROP and presses "Link"; both businesses then see the link ("waiting for the agency to match your requirements"). The employer puts its agencies in order (1, 2, 3) and chooses per agency whether people they put forward are booked straight away or approved first. Either side can end a link, with a reason the other sees. Links work once, last 7 days and can be cancelled. A business that isn't part of a link sees nothing of it (tested), and every step is logged on both sides. Credentials from the industry templates now carry a shared code so the next step can suggest matches.
- Also shipped: matching requirements. On the agency's side each link has "Match requirements": the employer's credential requirements (must have, should have, optional, and which roles or shift duties need them) with a choice of the agency's own credentials for each; the same credential is pre-chosen when both came from an industry template. Once every must-have and should-have is matched, the link is active ("can be sent requests"). If the employer adds a requirement later, the link goes back to waiting until the agency matches it, and both sides see how many are left.
- Next: Agency fill itself: the button on a shift, requests going to agency 1, then 2, then 3 on the timer, and the agency's list of requests.
- Waiting on David: the public apply form (spam protection and the form's questions).

- Also (David's request, for the design phase): the office app now has a menu across the top instead of down the side, with related screens grouped (Workers ▾: workers, leave, compliance; Clients & sites ▾; Equipment & items ▾), and Settings and the person's menu on the right. The roster's controls are one row (site, ‹ week ›, a View menu), Needs attention shows the top five with "Show more", and a bar along the bottom counts shifts by stage.
- Also (David's request): the roster itself now starts much higher on the page. Under the status bar is a slim summary strip, then Needs attention, Add shifts and Templates and copying sit side by side, a third of the width each, all closed when the page opens (opening one gives it the full width). Cover gaps are a closed strip below them.
- Also (David's request): the roster's Draft/Live status and Publish button moved up into the title row with the site picker, dates and View menu, so the top of the roster is one line on a laptop; the period button now shows the dates (press it to go back to this week).
- Also (David's request): a Full page button on the roster. It hides the menu bar and folds the summary, Needs attention, Add shifts, templates and cover gaps into one full-width "Summary, alerts and tools" line that drops down when clicked, so the roster gets almost the whole screen. The browser remembers the choice; Exit full page brings everything back.
- Also (David's request): By area view now has one row per area instead of one per person. Each card names who is on it (or says Unfilled) with the role underneath, the row says how many shifts and how many unfilled, and Hours shows filled / needed. Day view bars show the name only so they don't clip.
- Fix (David found it): adding a shift with only Fri ticked and no Until put it on the From date (Monday) instead. Ticked days now work without Until (the shifts go on those days in the week from From), From starts at today in the current week, and the message says the dates, e.g. "1 shift added on Fri 30 Oct".

## 2026-10-29 evening, 6:15pm Melbourne (scheduled run)

- Shipped: Agency fill itself (first slice). On the roster, an open shift's panel has "Send to agencies" with an optional note. The first agency in the business's order gets it straight away; the next ones get it in turn if nobody has been put forward: 10 minutes apart when the shift starts within 2 hours, an hour apart later the same day, two hours apart for later days (David's defaults). The panel shows who has it since when and when the next agency gets it, with "Send to <agency> now" and "Take it back". Filling the shift yourself, cancelling it, or the shift starting takes it back from every agency automatically. On the agency's side a new Allocations page (in the menu only for businesses that supply an employer) lists the requests with the site, local times, duties, the note and each requirement (must have / should have / optional, flagged where not matched yet); the agency's owners and admins get an email for each. No details about anyone's people cross between businesses, and a third business sees nothing (tested).
- Next: the agency choosing who goes (its people who meet the employer's requirements, ready first), then booking them onto the employer's roster (straight away or approve first).
- Waiting on David: the public apply form (spam protection and the form's questions).
- Also shipped: the agency's people for each request. On Allocations, under each open request, the agency now sees which of its own people can go: those who hold what the employer requires (as the agency matched it to its own credentials) and pass the agency's own checks (right to work, visa hours, leave, availability, not already working then, rest, still employed), ready first with the fewest hours that week. A different role name only warns, since each business names roles its own way; "Can't go" lists everyone else with the reason. If the agency hasn't matched a must-have, nobody shows as ready and it says why.
- Next (unchanged): putting someone forward and booking them onto the employer's roster.

## 2026-10-29 evening, 9:10pm Melbourne (scheduled run)

- Shipped: agencies putting people forward. On Allocations, each of the agency's people who can go has "Put forward". CROP checks them again and puts them straight onto the employer's shift: booked, or (when the employer chose "we approve first" for that agency) pink "To approve" with Approve and Decline on the shift panel and "Approve Ana Example from Caring For You?" in Needs attention. The employer's owners and admins get an email, and the shift is taken back from the other agencies. The employer only ever holds the person's name and the agency's name: they don't appear in its Workers list, offers or messages, but do get a row on the By person roster. The agency sees how it went (booked, waiting, declined, taken off, cancelled), and the person counts as busy then on its own roster. A locked published week can't be changed this way either.
- Also: the privacy policy, worker notice and data processing agreement now say what an employer sees about an agency's worker (name, agency, shift, and that they met the requirements), for the lawyer to check. A test about agency timing that failed late in the evening (Melbourne time) now works at any hour.
- Next: offering to several of the agency's people at once (first to say yes goes), and emails to the agency when its person is approved, declined or taken off.
- Waiting on David: the public apply form (spam protection and the form's questions).

## 2026-10-30 early morning, 1:10am Melbourne (scheduled run)

- Shipped: after an agency puts someone forward. On Allocations, the agency can now pull its person out (with an optional reason) until the shift starts: the employer's shift opens again with them shown as pulled out (purple), and the employer's owners and admins get an email with the reason. It's refused once the shift has started ("contact the employer directly") or when the employer has locked the week. The agency's owners and admins now get an email when the employer approves, declines or takes off their person, records them as pulled out, or cancels the shift (never about the agency's own changes, never twice).
- Also: the privacy policy, worker notice and data processing agreement now mention that the employer sees any reason the agency gives when it pulls a worker out (for the lawyer to check). The reason box asks for no health details.
- Next: offering a request to several of the agency's people at once (first to say yes goes).
- Waiting on David: the public apply form (spam protection and the form's questions).
- Also shipped: agencies offering a request to several of their people at once. On Allocations, tick several people who can go and press "Offer to ticked" (open until the shift starts, or for 30 minutes up to 4 hours). Each gets an email and a text from the agency with their own link (no sign-in). The first to accept is checked again and goes onto the employer's shift (booked, or waiting for approval) and is told which; the others get an email that it has gone. The office can record a yes it heard by phone ("They said yes") or withdraw the offers. Nothing reaches the employer until someone accepts.
- Next: agency people counting for cover rules and equipment operator checks, or Needs attention on the agency's side.

## 2026-10-30 early morning, 3:20am Melbourne (scheduled run)

- Shipped: each business now sets its own agency fill timing. Settings → Agencies has "How long each agency gets": how long the first agency has a shift before the next one in the list gets it too, chosen separately for shifts starting within 2 hours, later today, and tomorrow or later (David's 10 minutes, 1 hour and 2 hours stay the defaults). Only owners and admins change it. On the roster, sending a shift to agencies uses the business's time for that shift, or the office can pick a different one just for that shift ("Next agency after"), and the panel says the gap used.
- Next: Needs attention on the agency's side, or agency people counting for cover rules and equipment operator checks.
- Waiting on David: the public apply form (spam protection and the form's questions).

## 2026-10-30 early morning, 6:20am Melbourne (scheduled run)

- Shipped: Needs attention for agencies. Allocations now opens with a Needs attention box (and the Dashboard shows it too, for any business that supplies employers) covering the next 7 days: requests nobody has been put forward for yet (what has been offered so far, and how many of the agency's people are ready, or that a must-have still needs matching), people the agency put forward who can no longer go by its own checks (a credential or right to work run out by the day, leave approved since, employment ended), people waiting for the employer's approval, and employers whose requirements the agency still has to match. Anything within a day comes first; each line opens the request. It reads only the agency's own records.
- Next: agency people counting for cover rules and equipment operator checks on the employer's side, or the worker app's sign-in and shifts.
- Waiting on David: the public apply form (spam protection and the form's questions).

## 2026-10-30 morning, 9:10am Melbourne (scheduled run)

- Shipped: people an agency puts forward now count for the employer's site cover rules (e.g. "someone with first aid on at all times") and for operating equipment (e.g. a forklift licence). When the agency puts someone forward, CROP notes which of the employer's listed credentials the agency confirmed they hold on that day (names only, nothing else from the agency's records), and the shift panel says "They confirmed: …". Agencies see the employer's cover and operator credentials in their matching list as optional, so they can match them.
- Also: the privacy policy, worker notice and data processing agreement say the employer sees which of its listed credentials an agency's worker held on the day (for the lawyer to check).
- Next: the worker app's sign-in and shifts, or the requirements email for agencies not on CROP.
- Waiting on David: the public apply form (spam protection and the form's questions).


## 2026-10-30 midday, 12:20pm Melbourne (scheduled run)

- Shipped: the first slice of the worker app. On a person's page, owners and admins press "Give app access"; the person then signs in to the CROP app with that email (only once it is verified) and sees their shifts for the next four weeks in weeks the office has published (booked, or to be confirmed), plus their open offers, which they can accept or decline in the app. The office sees "accepted the offer in the app" in the shift's history, and the after-publishing lock applies as for reply links.
- Not yet tried on a phone: that needs a development build, which needs an Expo account (an outside service).
- Next: availability and leave in the app, then my credentials with upload.
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it; checking the worker app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.

## 2026-10-30 afternoon, 3:10pm Melbourne (scheduled run)

- Shipped: availability and leave in the worker app. A new Availability tab lets people set their usual week (AM, PM, night or off for each day), mark particular dates as different, and ask for leave (kind, first day, how many days, an optional note). Leave asked for in the app always waits for an owner or admin on the Leave page; people can withdraw a request while it waits, but approved leave can only be cancelled by the office. The roster, the who-can-work list and bank fill see it straight away. The app only tells them how many of their shifts fall in the leave, not which, as the weeks may not be published yet.
- Next: my credentials with upload in the app, or possibly an email to the office when leave is asked for in the app.
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it; checking the worker app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.
- (30 Oct, with David) Shipped marker letters on roster cards so the rosterer sees a shift is more than labour: F/M for gender, V vehicles, E other equipment, I items, D duties. A shift can record the gender the client asked for (when adding shifts, or in the shift panel); each worker can have a gender recorded (F, M or not recorded). Someone of the other gender, or with none recorded, shows as a warning, never a block. Templates and copied weeks keep the request. Equipment types can be marked as vehicles (template vans, utes and trucks already are). Privacy policy, data processing terms and worker notice now mention gender. Next: carry the request to agencies.

## 2026-10-30 evening, 6:10pm Melbourne (scheduled run)

- Shipped: when a shift asks for a female or male worker and the employer sends it to agencies, the agency now sees that too: on Allocations, in the email it gets, and as a warning (never a block) on its people of another gender or with none recorded. If the employer changes the request while agencies still hold the shift, their copies follow. Only the request goes to the agency, never anyone's own gender.
- Next: my credentials with upload in the worker app, or the requirements email for agencies not on CROP.
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it; checking the worker app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.

## 2026-10-30 night, 9:15pm Melbourne (scheduled run)

- Shipped: credentials in the worker app. A fourth tab shows what the person's role still needs ("Add your First aid", "Your RSA runs out soon"), their credentials with expiry and whether the office has checked them, lets them add one (number, issued by, dates) and add a photo from the camera or a file (PDF or image, up to 10 MB). Nothing they add counts until an owner or admin checks it; the person's page says "Added by them in the app". They can't change or remove anything the office has checked.
- Not yet tried on a phone (needs the development build).
- Next: push notifications in the app, or an email to the office when leave or a credential arrives from the app.
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it; checking the worker app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.

## 2026-10-31 early morning, 12:20am Melbourne (scheduled run)

- Shipped: when someone asks for leave or adds a credential in the worker app, the business's owners and admins now get an email straight away. The leave email gives the person's name, the dates and how many of their shifts fall in them, with a link to the Leave page; it never says the kind of leave or repeats their note. The credential email names what they added (a vaccination is only "a vaccination record") with a link to their page to check it.
- Next: push notifications in the app need an Expo account and Apple/Google push keys (outside services), so they wait for David; next unheld work is manager mode in the app (item 9a) or the agency and onboarding follow-ups.
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it (and the Expo account push needs); checking the worker app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.


## 2026-10-31 early morning, 3:20am Melbourne (scheduled run)

- Shipped: the first part of manager mode in the app. Owners, admins and allocators who sign in to the CROP app now see a Needs attention list (the same one as the web roster: nobody on it, not confirmed, someone who can't work it, cover gaps; most urgent first) and a Requests tab with leave and roster changes waiting. Owners and admins can approve or decline them on the phone; approving leave says how many shifts now need someone else. A manager who is also rostered can switch to their own shifts and back.
- Not yet tried on a phone (needs the development build).
- Next: filling shifts from the phone (assign a ready person, offer to bank and casual staff, confirm, cancel) and a day/week roster view.
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it (and the Expo account push needs); checking the app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.

## 2026-10-31 morning, 6:15am Melbourne (scheduled run)

- Shipped: filling shifts from the phone in manager mode. Tapping anything in Needs attention opens that shift: put on someone who can work it (ready people first, any warnings asked about first), offer it to several bank and casual staff at once, mark someone as confirmed or approve an agency's person, take someone off, record that they pulled out, cancel it with a reason, and call or text the person on it. When a published week only lets owners and admins change it, the same buttons send them a request to approve instead.
- Not yet tried on a phone (needs the development build).
- Next: a day and week roster view in the app, publishing the week from the phone, and the covering line.
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it (and the Expo account push needs); checking the app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.

## 2026-10-31 morning, 9:15am Melbourne (scheduled run)

- Shipped: the roster on the phone in manager mode. A new Roster tab shows one week at a time (this week, next, or any other), for every site or one, a day at a time or the whole week; each shift says who is on it (or Unfilled) and its stage, and each day shows how many are still unfilled. Tapping a shift opens it to fill or change, as from Needs attention. The tab also shows whether each site's week is a draft or live (and how many changes since publishing), with the same Publish week / Publish changes button as the web, telling staff or not.
- Not yet tried on a phone (needs the development build).
- Next: the covering line from the phone, then the agency and onboarding follow-ups (push alerts wait for the Expo account).
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it (and the Expo account push needs); checking the app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.

## 2026-10-31 midday, 12:10pm Melbourne (scheduled run)

- Shipped: the covering line from the phone in manager mode. A shift now has a Covering part: it says who the shift covers (or nobody), and Change lists the people away that day first (on leave, leave requested, never the kind of leave), then everyone else; picking one saves it, Nobody clears it. It's hidden on cancelled and equipment-only shifts, and while the week's after-publishing rule stops this person changing shifts. No API change.
- Not yet tried on a phone (needs the development build).
- Next: the agency and onboarding follow-ups (push alerts with quiet hours wait for the Expo account; adding shifts stays on the web for now).
- Waiting on David: the public apply form (spam protection and the form's questions); a development build of the app to try it (and the Expo account push needs); checking the app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.
- (31 Oct, with David) Roster cards now have a column of letters down the left: the shift's letter, then colour-coded F/M, V, E, I, D, so operators see at a glance how much a shift involves.
- (31 Oct, with David) Recruitment step 1: the employee card. Workers now show as cards (photo initials, roles, ready-to-work light, employment and hours this week, next shift, next expiry, verified credentials as badges); the person's page opens with the full card and splits into tabs (Overview, Credentials, Right to work, Employment, Availability & leave, Shifts, Details, with notes). Next: the apply form and upload-by-link, then the recruitment board.
- (31 Oct, with David) Credentials, roles and equipment types are now grouped by industry (the industry templates the business applied first, then shared ones, the business's own, and other industries). Roles on a person are picked from a grouped tick list, and are no longer turned into capitals (which stopped role rules matching). The Settings page has a Roles section. The nursing starter set button is gone: industry templates do that job.
- (31 Oct, with David) Upload by link: the office can send a person a one-off link (7 days) from the Credentials tab, and onboarding's "Ask for what's still needed" now includes one. Through it, without signing in, they send photos or files of exactly what's still needed (and right to work proof once the office has recorded their details); everything waits for an owner or admin to check it, and the office is emailed when something arrives. A newer link stops the old one; the office can stop a link. Privacy policy updated to mention it.
- (31 Oct, with David) Recruitment board (Workers ▾ Recruitment): applicants as employee cards in Applied → Screening → Interview → Offer, then Onboarding (with steps done) and Started (last 30 days). Add an applicant straight onto the board; move forward or back, mark not proceeding (with a reason) and reopen later; Start onboarding from Offer. Applicants are kept off the roster. Every move is logged for the recruitment dashboard (time in stage, time to hire).
- (31 Oct, with David) Dashboards, first round (strategy doc https://claude.ai/artifact/8HsDrtMtQXr4KFAAwXRbof; David's answers 31 Oct: job focus set by the owner only, each business sets its own targets, daily email to become the dashboard's top items, agency-side dashboard after, costs seen by owners plus managers the owner chooses). The Dashboard now opens on the person's own dashboard: Allocator, Compliance, Recruitment or Overview, with five numbers across the top (four for Recruitment) and the lists to act on below; anyone can look at the others. Settings › Dashboards: the owner picks each office person's dashboard and who else sees costs; owners and admins set targets (a number is only marked on or off target once the business has set one; CROP's suggestion shows beside each). Next: the daily email as a copy of the dashboard's top items (replacing the separate digests), change since last period on each number, then the Owner/Ops and Employee views.

## 2026-10-31 afternoon, 3:15pm Melbourne (scheduled run)

- Shipped: drag and drop on the recruitment board (drag a card between Applied, Screening, Interview and Offer; starting onboarding still uses its button so the checklist is chosen), and a Recruitment card on each person's page: where they are, the same moves as the board (Reopen for someone not proceeding), and every move newest first with who made it and any note. No API change.
- Next: the daily email as a copy of each person's dashboard (item 13a), then change since last period on the dashboard numbers.
- Waiting on David: the public apply form (the form's questions); a development build of the app to try it (and the Expo account push needs); checking the app's Zitadel access token type is JWT; confirming owners and admins may give their own people app access.
- (31 Oct, with David) Daily dashboard email: each office person now gets one email a day from 8am with their own dashboard's top items (numbers off target first, what needs attention in the next 7 days, leave and roster change requests waiting on owners and admins, and for Compliance and Overview the credential and equipment dates to follow up). It replaces the separate compliance digest and only comes when something needs them. Next: change since last period on each number.
- (31 Oct, with David) Dashboard numbers now show the change since a week ago (green when better, red when worse) and a small 13-week trend line; the daily email says what each number was a week ago. CROP keeps one value per number per day from now on, so the comparisons appear after the first week.
- (31 Oct, with David) Manager mode in the app now starts with the person's own dashboard numbers in one swipeable row (off target first, then the change since a week ago), from the same measures as the web and the daily email. Not yet tried on a phone (needs the development build).
- (31 Oct) Shift duties (and the credentials each needs), the items list and the type picker when adding equipment are now grouped by industry like the other lists.
- (31 Oct) Time zones: timestamps on the Compliance page and the person's page now show in the business's own time zone, not Melbourne's.
- (31 Oct) Agency dashboard: a business that supplies employers through CROP can now give its office people the Agency dashboard (requests to fill in the next 7 days, share of requests we filled, time to put someone forward, people pulled out, people waiting for the employer's approval), with Allocations' Needs attention below. It also comes in the daily email and the app.
- (31 Oct) Audit log: every record added, changed or removed is now recorded with who did it (the person, the worker app, a link, or CROP itself), when, and the values before and after; nobody can change it. Owners and admins see it in Settings › Audit log, filtered by what and dates, and per person from their Details tab.
- (31 Oct) Agency copies follow the employer's shift: when the employer changes a shift's duties, times, role or area while agencies hold it, their copies update (with the requirements worked out again), and an agency with someone already put forward is emailed to check they can still work it.
- (31 Oct) A shift's day, start, end and break can now be changed from the roster's shift panel ("Change day or times"). It's refused, with the reason, when the person or equipment on it couldn't do the new times; the change is logged, follows the after-publishing rule, and agencies holding the shift are told.
- (31 Oct) Needs attention on the employer's side now shows agency escalations: an open shift that's with agencies says how many have been asked, that nobody is put forward yet, and when the next agency is asked.
- (31 Oct) Agencies are now told up front when equipment on a shift needs a licensed operator: the licence is a must-have in their copy of the request (so only people who hold it can be put forward), and it updates when equipment is booked or taken off while they hold the shift.
- (31 Oct) A shift's role and area can now be changed from the same place in the shift panel; refused when the person on it can't work the new role, logged, and followed by agencies holding it.
- (31 Oct) Roster templates and copying now use the business's own words in their summaries and errors ("2 jobs added", "There are no jobs at … to copy").
- (31 Oct) The daily email run stops early once everyone in a business has had today's email, so the hourly check costs nothing for the rest of the day.
- (31 Oct) Money (item costs and charges) now shows in the currency of the business's country: dollars for Australia, New Zealand and the US, pounds for the UK.
- (31 Oct, with David) Owners and admins can now take away a person's app access themselves, from the Worker app card on the person's page (or cancel an invitation still waiting). The app stops working for them at once; their record, shifts and history stay, the audit log shows who did it, and the app can be given again later.

## 2026-10-31 evening, 6:35pm Melbourne (scheduled run)

- Shipped: agencies not on CROP (David's answer 4). Settings › Agencies has a new "Agencies not on CROP" list (name, email, phone, notes; owners and admins add, change or switch off). An open shift's panel on the roster can now email any of them the shift with the standard requirements for the role and a section of special requirements for that shift (duties, equipment licences, a gender requested), each marked must have, ideal or optional, plus the office's note and who to reply to. Each email is listed on the shift; nothing on the shift changes. The privacy policy and data processing agreement say what these emails contain (no worker information).
- Next: when the outside agency replies, the office adds the named person to the shift as an unchecked agency worker (the second half of David's answer 4).
- Waiting on David: the public apply form's questions; a development build of the app (Expo account); checking the app's Zitadel access token type is JWT.

## 2026-10-31 night, 9:15pm Melbourne (scheduled run)

- Shipped: the second half of agencies not on CROP (David's answer 4, option 1). When an outside agency replies by email or phone, the open shift's panel has "They replied with someone?": pick the agency, type the person's first and last name, and they go on the shift booked, marked "unchecked" wherever they show (the shift panel says CROP hasn't checked their credentials or right to work and the agency is responsible for that). The same name from the same agency counts as one person, so they can't be double booked and their hours add up on the By person view; they never appear in the business's own people list. Privacy policy and data processing agreement now say the business may record that person's name.
- Not checked in a browser (no local sign-in set up in this run); the page builds and the API is tested.
- Next: a reply link for outside agencies (option 2) is for later; the next open backlog items are the agency and onboarding follow-ups.
- Waiting on David: the public apply form's questions; a development build of the app (Expo account); checking the app's Zitadel access token type is JWT.

## 2026-11-01 small hours, 12:10am Melbourne (scheduled run)

- Shipped: Getting started in the worker app. Someone being onboarded now sees their checklist at the top of My shifts ("2 of 5 done"), each step in plain words for them: add it in Credentials, sent and waiting for the office to check it, the office will tick this off, or contact the office about right to work. Nothing written for the office (who ticked what, notes) reaches the app. Credentials the checklist asks for now show in the Credentials tab even when their role doesn't need them, and an empty My shifts tells them their shifts come once the office has finished getting them started.
- Not yet tried on a phone (needs the development build).
- Next: right to work details from the app (or by the upload link only), then the other agency and onboarding follow-ups.
- Waiting on David: the public apply form's questions; a development build of the app (Expo account); checking the app's Zitadel access token type is JWT.

## 2026-11-01 early morning, 3:15am Melbourne (scheduled run)

- Shipped: right to work in the worker app. The Credentials tab now has a Right to work card: what the office has recorded (for example "Australian citizen", or a visa holder's visa end date), whether it's checked, and what to do. Once the office has recorded someone's details, they can take a photo or choose a file of their proof in the app; it goes onto their record for an owner or admin to check (the office is emailed, never with any numbers). The onboarding checklist's right to work step now points them to the app instead of saying "contact the office". The details themselves (status, visa, VEVO check) are still only recorded by the office.
- Not yet tried on a phone (needs the development build).
- Next: the other agency and onboarding follow-ups (a checklist chosen automatically by role; the agency seeing which of its people meet an employer's requirements ahead of time).
- Waiting on David: the public apply form's questions; a development build of the app (Expo account); checking the app's Zitadel access token type is JWT.

## 2026-11-01 morning, 6:15am Melbourne (scheduled run)

- Shipped: onboarding checklists chosen by role. In Settings › Onboarding checklists, each checklist can say which roles it is for (blank means anyone), and that can be changed later. Wherever onboarding starts (the person's page, the recruitment board and their Recruitment card) the checklist for the person's roles is already picked, and each choice shows its roles; adding a person has "The checklist for their roles". The checklist written for most of their roles wins, otherwise one for anyone; if no checklist fits, the office has to choose one. Role names in that form are now kept exactly as typed (they were being upper-cased, which stopped them matching).
- Next: the agency seeing which of its people meet an employer's requirements ahead of time, then other follow-ups.
- Waiting on David: the public apply form's questions; a development build of the app (Expo account); checking the app's Zitadel access token type is JWT.

## 2026-11-01 morning, 9:15am Melbourne (scheduled run)

- Shipped: an agency can now see which of its people meet an employer's requirements before any shift arrives (David's answer 1 on agency links). On the agency's "Match requirements" page for a link (now called "Matches and who is ready" in Settings › Agencies), a new part lists, for each of the employer's roles and each duty, how many of the agency's people are ready today ("3 of 12 ready"), and for everyone else what's missing (not recorded, not checked yet, expired, right to work) or worth checking (should-haves, expiring soon). While a must-have isn't matched it says "Nobody yet: match RSA first". It uses only the agency's own records; nothing goes to the employer.
- Not checked in a browser (no local sign-in in this run); the page builds and the API is tested.
- Next: other agency follow-ups (limiting a link to some roles or sites; sharing documents by agreement) and the remaining onboarding pieces.
- Waiting on David: the public apply form's questions; a development build of the app (Expo account); checking the app's Zitadel access token type is JWT.

## 2026-11-01 afternoon, 12:15pm Melbourne (scheduled run)

- Shipped: items can be dragged from the roster's left strip onto a shift, like people and equipment. Dropping one adds one of that item: given to the person on the shift when there is one, otherwise recorded as used on the shift. The shift's panel then opens with a message saying what happened, so the office can change how many or return it. Counted items the business has none of are greyed out and can't be dragged; the usual stock check at the shift's site still applies.
- Not checked in a browser (no local sign-in in this run); the page builds and the new helpers are tested.
- Next: the roster's remaining design pieces (Template stage, app requests panel) wait on Steve's answer; next unheld items are the agency follow-ups (limiting a link to some roles or sites) and a shorter link for offer texts.
- Waiting on David: the public apply form's questions; a development build of the app (Expo account); checking the app's Zitadel access token type is JWT.

## 2026-11-01 afternoon, 3:15pm Melbourne (scheduled run)

- Shipped: cheaper texts. Every text CROP sends is now written in plain characters before it goes (the dash in "07:00–15:30", curly quotes and the like become plain ones; names are never changed). That one dash was making every offer, booking and roster text "Unicode", where a text part holds 70 characters instead of 160, so a typical shift offer with its link now goes as two parts instead of four. The Messages page shows each text's parts (and which character made it cost more, when a name needs one), texts this month with their parts, and names every kind of message; the month's count now starts on the 1st in the business's own time zone.
- Not checked in a browser (no local sign-in in this run); the page builds and the wording is tested.
- Question for David (in the backlog): shorten the links in texts (about 25 characters fewer, often one part less per offer)? Held because the link is the person's only key to the offer.
- Next: the agency follow-ups (limiting a link to some roles or sites) and other unheld items.
- Waiting on David: the public apply form's questions; a development build of the app (Expo account); checking the app's Zitadel access token type is JWT; the shorter-link question.
- (1 Nov, with David) The build schedule is revised (Caring For You live Monday 11 January 2027, after the Christmas quiet period) and its source now lives in `docs/schedule/`. Every scheduled run now updates and republishes it, and ticks off David's "what we need from you" list as items arrive, so the pages match on his phone and his Mac.
- (1 Nov, with David) David made the Expo account. Added `apps/mobile/eas.json` and a "Build the worker app" workflow that builds the app on Expo's servers; once David adds the Expo token to GitHub, he can start an Android test build that installs straight on a phone and talks to staging. iPhone builds follow once Apple approves the developer account.

## 2026-11-01 evening, 6:15pm Melbourne (scheduled run)

- Shipped: agencies limited to some sites (from the approved agency design). In Settings › Agencies, a business with more than one site now chooses, for each agency, which sites it fills (every site ticked, or none, means all of them, including sites added later). A shift only goes to the agencies that fill its site; if the choice changes while a request is waiting for an agency's turn, that turn is skipped and the shift panel says why; when none of the agencies fills a site, the panel says so instead of offering to send. Each change is logged.
- Not checked in a browser (no local sign-in in this run); the page builds and the API is tested.
- Next: limiting a link to some roles, letting the agency see which sites it fills, and other unheld items.
- Waiting on David: the public apply form's questions; the Expo token and first app build; checking the app's Zitadel access token type is JWT; the shorter-link question.
