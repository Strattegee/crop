-- Shift swaps between workers in the app (3 Nov 2026; Steve's answer 5, 26 Oct: "optional shift swaps agreed between
-- workers in the app", a setting each business chooses). A person on a published shift asks a colleague either to
-- take it (hand over) or to swap it for one of the colleague's shifts. The colleague says yes or no in the app; then,
-- depending on the business's setting, the swap happens at once or waits for an owner or admin to approve it.
--
--   tenant_settings.shift_swaps  off        nobody can ask (the default)
--                                approve    the colleague agrees, then an owner or admin approves
--                                automatic  the swap happens as soon as the colleague agrees
--
-- A swap is made through the ordinary assign rules (role, credentials, right to work, leave, double booking, visa
-- hours, after-publishing lock), so nothing about eligibility is new here.

alter table tenant_settings add column shift_swaps text not null default 'off'
  check (shift_swaps in ('off', 'approve', 'automatic'));

-- Coming off a shift because of a swap (so the log and reports can tell it from the office removing someone).
alter table shift_assignments drop constraint shift_assignments_removed_reason_check;
alter table shift_assignments add constraint shift_assignments_removed_reason_check
  check (removed_reason in ('office', 'pulled_out', 'swap'));

create table shift_swaps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  -- The asker's shift and the colleague's (null = hand over: the colleague just takes the asker's shift).
  shift_id uuid not null references shifts(id),
  from_worker_id uuid not null references workers(id),
  to_worker_id uuid not null references workers(id),
  other_shift_id uuid references shifts(id),
  -- asked: waiting for the colleague; agreed: waiting for an owner or admin; done: made;
  -- declined: the colleague said no; refused: the office said no; withdrawn: the asker took it back;
  -- closed: something changed first (a shift cancelled, started, or someone came off it).
  status text not null default 'asked'
    check (status in ('asked', 'agreed', 'done', 'declined', 'refused', 'withdrawn', 'closed')),
  created_by uuid,
  answered_at timestamptz,
  decided_at timestamptz,
  decided_by uuid,
  decided_by_name text,
  -- Plain words for refused or closed (from the office or from the rules); never health or leave details.
  reason text check (reason is null or length(reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_worker_id <> to_worker_id),
  check (other_shift_id is null or other_shift_id <> shift_id)
);
create index shift_swaps_shift_idx on shift_swaps(tenant_id, shift_id);
create index shift_swaps_other_idx on shift_swaps(tenant_id, other_shift_id);
create index shift_swaps_to_idx on shift_swaps(tenant_id, to_worker_id, status);
-- One open ask per shift at a time.
create unique index shift_swaps_one_open on shift_swaps(shift_id) where status in ('asked', 'agreed');
alter table shift_swaps enable row level security;
create policy tenant_isolation on shift_swaps using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on shift_swaps from crop_app;
create trigger shift_swaps_audit after insert or update or delete on shift_swaps for each row execute function app_audit();

-- When someone comes off a shift other than by the swap itself (removed, pulled out, the shift cancelled), any open
-- swap that relies on them being on it closes.
create function app_close_swaps_on_removal() returns trigger language plpgsql as $$
begin
  if new.resource_kind = 'worker' and new.status = 'removed' and old.status <> 'removed'
     and coalesce(new.removed_reason, 'office') <> 'swap' then
    update shift_swaps set status = 'closed', reason = 'Someone came off one of the shifts', updated_at = now()
     where status in ('asked', 'agreed')
       and ((shift_id = new.shift_id and from_worker_id = new.worker_id)
         or (other_shift_id = new.shift_id and to_worker_id = new.worker_id));
  end if;
  return new;
end $$;
create trigger shift_assignments_close_swaps after update on shift_assignments
  for each row execute function app_close_swaps_on_removal();
