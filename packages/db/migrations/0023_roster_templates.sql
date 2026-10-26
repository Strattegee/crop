-- Roster templates (backlog item 2, Steve's "ideal week"): a site's usual week saved as a template, then
-- applied to any week that isn't over. Each template shift keeps the weekday, the local start and finish,
-- the break, area, role, shift type and, optionally, the person who usually works it. Applying creates
-- ordinary shifts (logged by the 0022 triggers) and puts the usual person on each where they're eligible.
-- Copying the previous week works the same way straight from the shifts, without a template.

create table roster_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null references facilities(id),
  name text not null check (length(trim(name)) between 1 and 80),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  -- Templates are put away, never deleted, so we can always tell where a week came from.
  archived_at timestamptz
);
create unique index roster_templates_name_uniq on roster_templates(facility_id, lower(name)) where archived_at is null;
alter table roster_templates enable row level security;
create policy tenant_isolation on roster_templates using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on roster_templates from crop_app;

create table roster_template_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  template_id uuid not null references roster_templates(id),
  weekday int not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 0 check (break_minutes between 0 and 240),
  area_id uuid references areas(id),
  shift_code_id uuid references shift_codes(id),
  role text not null check (length(trim(role)) between 1 and 60),
  needs_person boolean not null default true,
  worker_id uuid references workers(id),
  notes text,
  check (start_time <> end_time),
  check (needs_person or worker_id is null)
);
create index roster_template_shifts_template_idx on roster_template_shifts(template_id, weekday, start_time);
alter table roster_template_shifts enable row level security;
create policy tenant_isolation on roster_template_shifts using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on roster_template_shifts from crop_app;
