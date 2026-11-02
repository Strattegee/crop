# Allocation screen for client shifts (2 Nov 2026, David)

## The problem

Caring For You (the beta business, a nursing and labour-hire agency) fills 200–300 client shifts a day. Most clients also
ask other agencies, so filling is a race: the agency that books a suitable person first gets the shift. The allocation
screen has to make the next shift to fill obvious, get a person on it in as few steps as possible, and keep several
allocators from tripping over each other.

David's notes on how the team works today, written from the agency's current third-party system, are in
`docs/research/c4u-allocation-screen/` (names replaced with placeholders; wireframes redrawn, no screenshots). They are
only a picture of how the team works now and what slows them down. **CROP must not copy that system's screens**, layout
or wording; we design our own.

## David's answers (2 Nov)

1. *After a worker accepts, does the client have to confirm before the shift is filled?*
   **It's per client; we need an option in the client set-up.**
   Built 2 Nov (migration 0069): `clients.confirms_bookings` ("Client confirms each booking before it's filled"). A booked
   shift on such a client's order is at the stage "client to confirm" until the office records the client's yes
   (`POST /shifts/:id/client-confirmed`); the booked email to that client asks them to confirm. If the client says no, the
   office removes the person as usual.
2. *Their old system has a client Priority 1–7. What is it?*
   **It is a rank of client value: many clients are very loyal, others use them as a fill-in, last option.**
   Built 2 Nov: `clients.rank` (1 = most loyal … 7 = fill-in; empty = not ranked). Allocations orders shifts that start at
   the same time by rank, ranked clients first.
3. *Do allocators split the work?*
   **Allocators sometimes isolate a region or office depending on how busy it is; mostly it's a race to fill fast.**
   To build with the screen: a quick filter by region or office that stays on while someone works, and making it plain
   who is working on what (without locks that are taken by accident).

## Direction under discussion (not yet chosen by David)

A design canvas with three layouts: https://claude.ai/artifact/FrMuqNf8rBpJovjf3TP3NE

- **A. Urgent queue with a fill panel (recommended).** One list of shifts still to fill, most urgent first (starting
  soonest, then client rank), with the fill panel beside it: ranked people, offer or assign in one click, then the next
  shift opens.
- **B. Stage board.** Columns by stage (unfilled, offered, allocated, client to confirm, booked) with cards moving across.
- **C. Group and release in bulk.** Shifts grouped (by site, role or time) and released to many people at once.

Until David chooses, the data and API are ready for any of them: stages including "client to confirm", client rank, and
`GET /allocations/client-shifts`.
