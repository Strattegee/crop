-- Cancel reasons and a call log (David, 3 Nov 2026, answer 1: the live numbers count "client cancelled" apart from
-- other cancellations, and "calls made" per allocation officer).

-- Why a shift was cancelled: the client cancelled, the client withdrew the request, we couldn't fill it, our mistake,
-- or other. Null on shifts cancelled before this (counted as other). The free-text reason stays in cancelled_reason.
alter table shifts add column cancel_kind text
  check (cancel_kind is null or cancel_kind in ('client_cancelled', 'client_withdrew', 'not_filled', 'our_mistake', 'other'));
alter table shifts add constraint shifts_cancel_kind_only_cancelled check (cancel_kind is null or status = 'cancelled');
-- A change request to cancel carries the kind too, so approving it cancels with the same kind.
alter table roster_change_requests add column cancel_kind text
  check (cancel_kind is null or cancel_kind in ('client_cancelled', 'client_withdrew', 'not_filled', 'our_mistake', 'other'));

-- The call log: calls the office made (or took) to a worker or a client, with the outcome and a short note. CROP
-- doesn't dial; it records. Append-only (a mistake is a new entry), so it is its own history: no audit trigger.
create table call_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  -- Who in the office made it (their name copied, since crop_app can't read users).
  user_id uuid not null references users(id),
  user_name text not null check (length(user_name) between 1 and 200),
  at timestamptz not null default now(),
  direction text not null default 'out' check (direction in ('out', 'in')),
  worker_id uuid references workers(id),
  client_id uuid references clients(id),
  contact_id uuid references client_contacts(id),
  -- The client contact's name as said (a saved contact's name, or who asked on the order).
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  shift_id uuid references shifts(id),
  outcome text not null check (outcome in ('answered', 'no_answer', 'left_message', 'said_yes', 'said_no')),
  note text check (note is null or length(note) <= 300),
  check (worker_id is not null or client_id is not null)
);
create index call_logs_tenant_at_idx on call_logs(tenant_id, at desc);
create index call_logs_worker_idx on call_logs(tenant_id, worker_id, at desc) where worker_id is not null;
create index call_logs_shift_idx on call_logs(shift_id) where shift_id is not null;
alter table call_logs enable row level security;
create policy tenant_isolation on call_logs using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on call_logs from crop_app;
