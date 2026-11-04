-- Projects (David and Steve, 4 Nov 2026; docs/decisions/2026-11-04-projects.md). A business that runs its own work
-- (a builder that wins a contract, a café, an aged care home) sets up a project with work areas, a team, equipment
-- and consumables. A project is a site: `facilities.kind = 'project'` with a few fields of its own, so everything
-- already keyed by site (roster, templates, cover rules, stock per site and transfers, equipment bookings, the queue,
-- live numbers by office) works for projects unchanged. Work areas are the site's areas.

alter table facilities
  add column kind text not null default 'site' check (kind in ('site', 'project')),
  -- The business's own reference for the project, e.g. "P-2041" (unique among the business's sites).
  add column code text check (code is null or length(trim(code)) between 1 and 30),
  add column description text check (description is null or length(description) <= 2000),
  add column starts_on date,
  -- Expected completion.
  add column ends_on date,
  -- Projects only: planned / active / on_hold / completed / archived. Archived keeps every record and leaves the
  -- pickers (it is the project's `active = false`); a site has no status (its `active` flag is all it has).
  add column status text check (status is null or status in ('planned', 'active', 'on_hold', 'completed', 'archived')),
  -- The office person who runs it (an owner, admin or allocator; names come from app_office_team()).
  add column manager_user_id uuid references users(id),
  add constraint facilities_project_status check ((kind = 'project') = (status is not null)),
  add constraint facilities_project_active check (kind = 'site' or active = (status <> 'archived')),
  add constraint facilities_dates check (ends_on is null or starts_on is null or ends_on >= starts_on);
create unique index facilities_code_uniq on facilities(tenant_id, lower(trim(code))) where code is not null;
create index facilities_kind_idx on facilities(tenant_id, kind);

-- The project's team: who belongs to it, separately from who is on which shift. One person record across every
-- project. `ends_on` is their last day on the team (null = no end yet); a mistaken entry is marked `removed_at`
-- instead of being deleted. Overlapping memberships of one person in one site are refused by the API.
create table site_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null references facilities(id),
  worker_id uuid not null references workers(id),
  area_id uuid references areas(id),
  team_role text not null default 'worker' check (team_role in ('supervisor', 'worker')),
  starts_on date not null,
  ends_on date,
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_reason text check (removed_reason is null or length(removed_reason) between 1 and 200),
  check (ends_on is null or ends_on >= starts_on)
);
create index site_members_site_idx on site_members(tenant_id, facility_id) where removed_at is null;
create index site_members_worker_idx on site_members(tenant_id, worker_id) where removed_at is null;
alter table site_members enable row level security;
create policy tenant_isolation on site_members using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on site_members from crop_app;
grant update (area_id, team_role, ends_on, removed_at, removed_reason) on site_members to crop_app;
create trigger site_members_audit after insert or update or delete on site_members for each row execute function app_audit();

-- Equipment given to a project (or any site) for a period. While it is allocated somewhere, booking it onto a shift
-- at another site is a hard block (equipmentForShift). Moving it = ending one allocation and starting the next.
-- Dates are the site's local dates; `ends_on` null = until further notice. A mistaken entry is marked `removed_at`.
create table equipment_site_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  equipment_id uuid not null references equipment(id),
  facility_id uuid not null references facilities(id),
  area_id uuid references areas(id),
  starts_on date not null,
  ends_on date,
  note text check (note is null or length(note) <= 300),
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_reason text check (removed_reason is null or length(removed_reason) between 1 and 200),
  check (ends_on is null or ends_on >= starts_on)
);
create index equipment_site_allocations_equipment_idx on equipment_site_allocations(tenant_id, equipment_id) where removed_at is null;
create index equipment_site_allocations_site_idx on equipment_site_allocations(tenant_id, facility_id) where removed_at is null;
alter table equipment_site_allocations enable row level security;
create policy tenant_isolation on equipment_site_allocations using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on equipment_site_allocations from crop_app;
grant update (area_id, ends_on, removed_at, removed_reason) on equipment_site_allocations to crop_app;
create trigger equipment_site_allocations_audit after insert or update or delete on equipment_site_allocations
  for each row execute function app_audit();

-- Safety net under the API's checks: one piece of equipment is never allocated to two places on the same day. The
-- equipment row is locked first, so two allocations made at once wait for each other. (CRPJ1 = a 409 with this text.)
create function app_equipment_allocation_overlap() returns trigger language plpgsql as $$
declare clash record;
begin
  if new.removed_at is not null then return new; end if;
  perform 1 from equipment where id = new.equipment_id for update;
  select a.id, f.name into clash from equipment_site_allocations a join facilities f on f.id = a.facility_id
   where a.equipment_id = new.equipment_id and a.id <> new.id and a.removed_at is null
     and daterange(a.starts_on, a.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')
   limit 1;
  if found then
    raise exception 'That {equipment} is already allocated to % for some of those dates', clash.name using errcode = 'CRPJ1';
  end if;
  return new;
end $$;
create trigger equipment_site_allocations_overlap before insert or update on equipment_site_allocations
  for each row execute function app_equipment_allocation_overlap();

-- Same for team memberships: one person, one site, no overlapping dates.
create function app_site_member_overlap() returns trigger language plpgsql as $$
begin
  if new.removed_at is not null then return new; end if;
  perform 1 from workers where id = new.worker_id for update;
  if exists (select 1 from site_members m where m.facility_id = new.facility_id and m.worker_id = new.worker_id and m.id <> new.id
               and m.removed_at is null and daterange(m.starts_on, m.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')) then
    raise exception 'They are already on that team for some of those dates' using errcode = 'CRPJ1';
  end if;
  return new;
end $$;
create trigger site_members_overlap before insert or update on site_members
  for each row execute function app_site_member_overlap();

-- Areas and sites must match.
create function app_project_area_check() returns trigger language plpgsql as $$
begin
  if new.area_id is not null and not exists (select 1 from areas a where a.id = new.area_id and a.facility_id = new.facility_id) then
    raise exception 'Choose {an area} of that {site}' using errcode = 'CRPJ1';
  end if;
  return new;
end $$;
create trigger site_members_area before insert or update of area_id on site_members for each row execute function app_project_area_check();
create trigger equipment_site_allocations_area before insert or update of area_id on equipment_site_allocations
  for each row execute function app_project_area_check();
