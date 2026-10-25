-- Equipment on the roster (backlog item 4). Equipment (machines, vehicles, tools) is rostered like people:
-- booked to a shift for its time, in one place at once, with its own dates that must be current
-- (registration, service, inspection), and may need an operator who holds a given credential.

-- Kinds of equipment, e.g. "Forklift", "Light vehicle". The operator credential is data, not code.
create table equipment_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 80),
  -- Whoever is on a shift using this equipment must hold this credential (verified, current on the shift date).
  operator_credential_type_id uuid references credential_types(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index equipment_types_name_uniq on equipment_types(tenant_id, lower(name));

create type equipment_status as enum ('active', 'out_of_service', 'retired');

create table equipment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  equipment_type_id uuid not null references equipment_types(id),
  name text not null check (length(trim(name)) between 1 and 80),
  -- Fleet or asset number, and registration (rego) where it has one.
  asset_number text check (asset_number is null or length(asset_number) <= 40),
  registration text check (registration is null or length(registration) <= 20),
  -- Where it is usually kept; it can still be booked at any site.
  home_facility_id uuid references facilities(id),
  status equipment_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index equipment_name_uniq on equipment(tenant_id, lower(name));
create unique index equipment_asset_uniq on equipment(tenant_id, lower(asset_number)) where asset_number is not null;

-- Dates that must be current for the equipment to be used: registration, service, inspection, test and tag…
-- Recording a new date for the same name replaces the current one (superseded_at); history is kept.
create table equipment_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  equipment_id uuid not null references equipment(id),
  name text not null check (length(trim(name)) between 1 and 60),
  due_on date not null,
  notes text,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);
create unique index equipment_checks_current on equipment_checks(equipment_id, lower(name)) where superseded_at is null;
create index equipment_checks_due_idx on equipment_checks(tenant_id, due_on) where superseded_at is null;

-- Equipment on a shift is an assignment with resource_kind 'equipment'. A shift keeps one person and may have
-- several pieces of equipment; shift status still follows the person.
alter table shift_assignments add column equipment_id uuid references equipment(id);
alter table shift_assignments drop constraint shift_assignments_check;
alter table shift_assignments add constraint shift_assignments_resource_check check (
  ((resource_kind = 'worker') = (worker_id is not null)) and ((resource_kind = 'equipment') = (equipment_id is not null))
);
create unique index shift_assignments_one_equipment on shift_assignments(shift_id, equipment_id)
  where resource_kind = 'equipment' and status in ('assigned', 'confirmed');
create index shift_assignments_equipment_idx on shift_assignments(equipment_id) where status in ('assigned', 'confirmed');

alter table equipment_types enable row level security;
create policy tenant_isolation on equipment_types using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table equipment enable row level security;
create policy tenant_isolation on equipment using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table equipment_checks enable row level security;
create policy tenant_isolation on equipment_checks using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
