-- Changes a person asks for in the app to their own details (David, 3 Nov 2026, answer 5: "the person's change needs
-- approval"). When the business's field-access setting for a field is `approve`, the change waits here for an owner
-- or administrator; `change` applies it straight away and nothing is stored here (the audit log has it). The asked
-- value is never edited: approving applies it, declining or withdrawing closes the request. Audited.
create table detail_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  field text not null check (field in ('name', 'preferred_name', 'email', 'mobile', 'gender', 'address')),
  -- Addresses only: what to do, and which address (null when adding one).
  address_action text check (address_action in ('add', 'correct', 'current', 'remove')),
  address_id uuid references worker_addresses(id),
  -- The asked value: {"value": …} for one field, {"firstName", "lastName"} for the name, the address fields otherwise.
  asked jsonb not null,
  -- What it was when they asked, for the office to compare.
  was jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  requested_by uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  decided_by_name text,
  decided_note text check (decided_note is null or length(decided_note) <= 300),
  check ((field = 'address') = (address_action is not null)),
  check (address_action is null or (address_action = 'add') = (address_id is null)),
  check ((status = 'pending') = (decided_at is null))
);
create index detail_change_requests_worker_idx on detail_change_requests(tenant_id, worker_id, created_at desc);
create index detail_change_requests_pending_idx on detail_change_requests(tenant_id, created_at) where status = 'pending';
-- One waiting change per field (and per address; adding counts as one).
create unique index detail_change_requests_one_pending on detail_change_requests(worker_id, field, coalesce(address_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pending';
alter table detail_change_requests enable row level security;
create policy tenant_isolation on detail_change_requests using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Personal details: never for supervisors (migration 0086's pattern).
create policy not_supervisor on detail_change_requests as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
revoke update, delete on detail_change_requests from crop_app;
grant update (status, decided_at, decided_by, decided_by_name, decided_note) on detail_change_requests to crop_app;
create trigger detail_change_requests_audit after insert or update or delete on detail_change_requests for each row execute function app_audit();
