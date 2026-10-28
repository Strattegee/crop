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
- Next: the same words in the office's change-request emails, the offer link page and error messages, or the worker app once its sign-in is confirmed.
- Waiting on David: approval of the agency connections design and its four questions (unchanged); the worker app's client ID in Zitadel; applying online and uploading documents through a link (both open CROP to the public, so held).
