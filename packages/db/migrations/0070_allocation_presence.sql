-- Who is looking at which shift on Allocations (David, 2 Nov 2026: "make it plain who is working on what, without
-- locks taken by accident"). Opening a shift's fill panel records the office person against it; the queue shows their
-- initials for two minutes. Nothing is locked: if two people act, the API's own checks decide. Short-lived working
-- state, not a business record, so no audit trigger; rows older than a day are cleared when anyone opens a shift.
create table allocation_presence (
  tenant_id uuid not null references tenants(id),
  shift_id uuid not null references shifts(id),
  user_id uuid not null,
  name text not null check (length(name) between 1 and 200),
  seen_at timestamptz not null default now(),
  primary key (shift_id, user_id)
);
create index allocation_presence_recent_idx on allocation_presence(tenant_id, seen_at);
alter table allocation_presence enable row level security;
create policy tenant_isolation on allocation_presence using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
