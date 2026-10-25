-- Employer roster foundations (ROS-): employment terms, shift codes, shifts and assignments.
-- A shift is one position to fill. Assignments hold who (or, later, which equipment) fills it,
-- so requirement and allocation stay separate. Equipment arrives with its own table; the
-- resource_kind column is there so assignments don't need reshaping then.

create type employment_type as enum ('full_time', 'part_time', 'casual', 'bank');

-- Effective-dated: a new term starts the day after the previous one ends.
create table employment_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  employment_type employment_type not null,
  contracted_hours numeric(5,2) check (contracted_hours is null or (contracted_hours >= 0 and contracted_hours <= 80)),
  starts_on date not null,
  ends_on date,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index employment_terms_worker_idx on employment_terms(worker_id, starts_on desc);

-- Shift codes: business-wide (facility_id null) or for one site. Times are local to the site.
create table shift_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid references facilities(id),
  code text not null check (length(trim(code)) between 1 and 12),
  name text,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 0 check (break_minutes between 0 and 240),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (start_time <> end_time)
);
create unique index shift_codes_code_uniq on shift_codes(tenant_id, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));

create type shift_status as enum ('open', 'assigned', 'booked', 'cancelled');

create table shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null references facilities(id),
  area_id uuid references areas(id),
  shift_code_id uuid references shift_codes(id),
  role text not null check (length(trim(role)) between 1 and 60),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes int not null default 0 check (break_minutes between 0 and 240),
  status shift_status not null default 'open',
  notes text,
  cancelled_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);
create index shifts_tenant_time_idx on shifts(tenant_id, starts_at);
create index shifts_facility_time_idx on shifts(facility_id, starts_at);

create type assignment_status as enum ('assigned', 'confirmed', 'declined', 'removed');

create table shift_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  shift_id uuid not null references shifts(id),
  resource_kind text not null default 'worker' check (resource_kind in ('worker', 'equipment')),
  worker_id uuid references workers(id),
  status assignment_status not null default 'assigned',
  assigned_by uuid,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((resource_kind = 'worker') = (worker_id is not null))
);
-- One person per shift at a time.
create unique index shift_assignments_one_worker on shift_assignments(shift_id)
  where resource_kind = 'worker' and status in ('assigned', 'confirmed');
create index shift_assignments_worker_idx on shift_assignments(worker_id) where status in ('assigned', 'confirmed');

alter table employment_terms enable row level security;
create policy tenant_isolation on employment_terms using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table shift_codes enable row level security;
create policy tenant_isolation on shift_codes using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table shifts enable row level security;
create policy tenant_isolation on shifts using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table shift_assignments enable row level security;
create policy tenant_isolation on shift_assignments using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

