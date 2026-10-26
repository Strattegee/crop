-- Requesting and approving a change after publishing (backlog item 2, Steve's answer 5: "changes are
-- requested and approved"). When the business's rule stops someone changing a live week (migration 0024),
-- they can ask for the change instead: put a person on, confirm them, take them off, record that they pulled out, cancel
-- the shift, or something else in words. An owner or admin approves it (the change is then made as theirs,
-- through the same rules as any other change, and logged) or declines it. Requests are never deleted.

create table roster_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  shift_id uuid not null references shifts(id),
  facility_id uuid not null references facilities(id),
  week_start date not null check (extract(isodow from week_start) = 1),
  kind text not null check (kind in ('assign', 'confirm', 'remove', 'pulled_out', 'cancel', 'other')),
  worker_id uuid references workers(id),
  reason text check (reason is null or length(reason) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  requested_by uuid not null,
  requested_by_name text,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 300),
  check ((kind = 'assign') = (worker_id is not null)),
  check (kind not in ('cancel', 'other') or reason is not null),
  check ((status = 'pending') = (decided_at is null))
);
-- One request waiting per shift, so two people can't ask for conflicting changes at once.
create unique index roster_change_requests_pending_uniq on roster_change_requests(shift_id) where status = 'pending';
create index roster_change_requests_week_idx on roster_change_requests(facility_id, week_start, created_at desc);
alter table roster_change_requests enable row level security;
create policy tenant_isolation on roster_change_requests using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on roster_change_requests from crop_app;
