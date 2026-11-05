-- Project stages (David, 5 Nov 2026, part 3 of docs/decisions/2026-11-05-teams-and-stages.md). A project (a site of
-- kind 'project') runs in stages, e.g. Beach Hut: demolition and make good 4 days (Demolition team), build 9 days
-- (Build team), clean 2 days (Cleaning team). Each stage has its dates, its working days (Monday to Friday unless
-- Saturday or Sunday are ticked), its usual hours (or a shift type) and its own copy of a standing team: choosing a
-- team copies its make-up and current people into the stage's rows, which the office then changes for this stage
-- only; the standing team (`teams`, migration 0092) is never changed. Stages may overlap.
-- One supervisor per project works on it full time: `facilities.supervisor_worker_id` (a person who is rostered,
-- unlike `manager_user_id`, an office sign-in).

alter table facilities
  add column supervisor_worker_id uuid references workers(id),
  add constraint facilities_supervisor_project check (supervisor_worker_id is null or kind = 'project');

create table project_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null references facilities(id),
  name text not null check (length(trim(name)) between 1 and 80),
  area_id uuid references areas(id),
  starts_on date not null,
  ends_on date not null,
  -- ISO weekdays worked (1 = Monday … 7 = Sunday); Monday to Friday unless the office ticks the weekend.
  weekdays smallint[] not null default '{1,2,3,4,5}'
    check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  -- The usual hours, in the site's local time (end before start = overnight), or a shift type's.
  start_time time,
  end_time time,
  break_minutes smallint not null default 0 check (break_minutes between 0 and 240),
  shift_code_id uuid references shift_codes(id),
  -- The standing team the stage's make-up and people were copied from (a record of the source, never changed by the stage).
  team_id uuid references teams(id),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Taken off (kept on file); shifts already created stay.
  removed_at timestamptz,
  removed_reason text check (removed_reason is null or length(removed_reason) between 1 and 200),
  check (ends_on >= starts_on),
  check (shift_code_id is not null or (start_time is not null and end_time is not null and start_time <> end_time))
);
create index project_stages_site_idx on project_stages(tenant_id, facility_id) where removed_at is null;
alter table project_stages enable row level security;
create policy tenant_isolation on project_stages using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy site_scope on project_stages as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
revoke delete on project_stages from crop_app;
create trigger project_stages_audit after insert or update or delete on project_stages for each row execute function app_audit();
create trigger project_stages_area before insert or update of area_id on project_stages for each row execute function app_project_area_check();

-- Stages belong to projects only.
create function app_project_stage_check() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from facilities f where f.id = new.facility_id and f.kind = 'project') then
    raise exception 'Stages belong to {a project}' using errcode = 'CRPJ1';
  end if;
  return new;
end $$;
create trigger project_stages_project before insert or update of facility_id on project_stages
  for each row execute function app_project_stage_check();

-- The stage's make-up: how many of each role it needs (exact role names, like credential rules). Replaced as a set:
-- earlier lines are marked `removed_at`, never edited or deleted.
create table project_stage_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  stage_id uuid not null references project_stages(id),
  role text not null check (length(trim(role)) between 1 and 80),
  count smallint not null check (count between 1 and 99),
  position smallint not null default 0,
  removed_at timestamptz
);
create unique index project_stage_roles_live on project_stage_roles(stage_id, role) where removed_at is null;
create index project_stage_roles_stage_idx on project_stage_roles(tenant_id, stage_id) where removed_at is null;
alter table project_stage_roles enable row level security;
create policy tenant_isolation on project_stage_roles using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy site_scope on project_stage_roles as restrictive
  using (app_site_scope() is null or exists (select 1 from project_stages s where s.id = stage_id))
  with check (app_site_scope() is null or exists (select 1 from project_stages s where s.id = stage_id));
revoke update, delete on project_stage_roles from crop_app;
grant update (removed_at) on project_stage_roles to crop_app;
create trigger project_stage_roles_audit after insert or update or delete on project_stage_roles for each row execute function app_audit();

-- The stage's named people and the role each fills. Taking someone off marks `removed_at`; adding again is a new row.
create table project_stage_people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  stage_id uuid not null references project_stages(id),
  worker_id uuid not null references workers(id),
  role text not null check (length(trim(role)) between 1 and 80),
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_reason text check (removed_reason is null or length(removed_reason) between 1 and 200)
);
create unique index project_stage_people_live on project_stage_people(stage_id, worker_id) where removed_at is null;
create index project_stage_people_stage_idx on project_stage_people(tenant_id, stage_id) where removed_at is null;
create index project_stage_people_worker_idx on project_stage_people(tenant_id, worker_id) where removed_at is null;
alter table project_stage_people enable row level security;
create policy tenant_isolation on project_stage_people using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy site_scope on project_stage_people as restrictive
  using (app_site_scope() is null or exists (select 1 from project_stages s where s.id = stage_id))
  with check (app_site_scope() is null or exists (select 1 from project_stages s where s.id = stage_id));
revoke update, delete on project_stage_people from crop_app;
grant update (removed_at, removed_reason) on project_stage_people to crop_app;
create trigger project_stage_people_audit after insert or update or delete on project_stage_people for each row execute function app_audit();

-- Shifts made by "Roster this stage": linked to the stage so a second run only adds what's missing. The project
-- supervisor's daily shift is marked `project_supervisor` (one a day, however many stages run that day).
alter table shifts
  add column project_stage_id uuid references project_stages(id),
  add column project_supervisor boolean not null default false;
create index shifts_project_stage_idx on shifts(tenant_id, project_stage_id) where project_stage_id is not null;
create index shifts_project_supervisor_idx on shifts(tenant_id, facility_id) where project_supervisor;

-- Equipment booked for a stage's dates ("Book equipment for this stage") is an ordinary allocation to the project,
-- marked with the stage it was booked for.
alter table equipment_site_allocations add column project_stage_id uuid references project_stages(id);
