-- Bank fill (backlog item 6): offering an open shift to several of the business's own people.
-- The first to accept is booked. One person per shift is already enforced by shift_assignments_one_worker;
-- accepting locks the shift row and the worker row, and re-checks eligibility (no double booking).
-- Offers are a record of who was asked and what they said; they are never deleted.

create type offer_status as enum ('pending', 'accepted', 'declined', 'withdrawn', 'filled');

create table shift_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  shift_id uuid not null references shifts(id),
  worker_id uuid not null references workers(id),
  status offer_status not null default 'pending',
  -- After this the offer can't be accepted (null: open until the shift is filled or the offer withdrawn).
  expires_at timestamptz,
  offered_by uuid,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid,
  check ((status = 'pending') = (responded_at is null))
);
-- Someone is asked about a shift once at a time.
create unique index shift_offers_one_pending on shift_offers(shift_id, worker_id) where status = 'pending';
create index shift_offers_shift_idx on shift_offers(shift_id, created_at);
create index shift_offers_worker_idx on shift_offers(worker_id) where status = 'pending';

alter table shift_offers enable row level security;
create policy tenant_isolation on shift_offers using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on shift_offers from crop_app;
