-- Client settings and the "client to confirm" stage (David, 2 Nov 2026).
--
-- Some clients confirm each booking before the shift counts as filled; others don't. It's per client. Clients also
-- have a rank (1 = most loyal … 7 = a fill-in, last option), which orders the allocation screen when shifts start at
-- the same time. Null = not ranked (after the ranked ones).
alter table clients
  add column confirms_bookings boolean not null default false,
  add column rank smallint check (rank between 1 and 7);

-- When the client confirmed the person booked on a shift from their order. The confirmation belongs to that person:
-- if someone else is booked later, it no longer counts (compared with the person on the shift when read). Changing
-- these columns logs nothing in shift_changes (app_shifts_changed doesn't look at them), so it isn't a roster change
-- and the after-publishing rules don't apply; the shifts audit trigger records who and when.
alter table shifts
  add column client_confirmed_at timestamptz,
  add column client_confirmed_by text check (client_confirmed_by is null or length(client_confirmed_by) <= 200),
  add column client_confirmed_worker_id uuid references workers(id);
