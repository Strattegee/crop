-- Availability and leave (backlog item 10).
-- Availability: when someone can usually work (a weekly pattern by day and AM / PM / night) and
-- one-off changes for a date ("can't work Saturday", "can do a night on the 14th"). A date entry
-- replaces the pattern for that day. Someone with no pattern and no entry for a date is treated as
-- available (nothing recorded). Not being available is a warning when rostering, never a block.
-- Leave: whole days, requested or approved by the office. Approved leave blocks rostering on those days;
-- requested leave is a warning. The kind of leave is never shown in eligibility reasons or messages.

-- Usual weekly pattern. One row per weekday the person has said something about;
-- periods lists the parts of the day they can work (empty = not that day).
create table availability_patterns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  weekday smallint not null check (weekday between 1 and 7), -- 1 = Monday … 7 = Sunday
  periods text[] not null check (periods <@ array['am', 'pm', 'night']::text[]),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (worker_id, weekday)
);

alter table availability_patterns enable row level security;
create policy tenant_isolation on availability_patterns using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- A change for one date (in the site's local calendar). Replaces the weekly pattern for that day.
create table availability_dates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  on_date date not null,
  periods text[] not null check (periods <@ array['am', 'pm', 'night']::text[]),
  note text check (note is null or length(note) <= 300),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (worker_id, on_date)
);
create index availability_dates_date_idx on availability_dates(tenant_id, on_date);

alter table availability_dates enable row level security;
create policy tenant_isolation on availability_dates using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

create type leave_kind as enum ('annual', 'personal', 'long_service', 'unpaid', 'other');
create type leave_status as enum ('requested', 'approved', 'declined', 'cancelled');

-- Leave is a record: it is declined or cancelled, never deleted.
create table leave_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  kind leave_kind not null,
  starts_on date not null,
  ends_on date not null,
  status leave_status not null default 'requested',
  note text check (note is null or length(note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  check (ends_on >= starts_on and ends_on - starts_on <= 366)
);
create index leave_records_worker_idx on leave_records(worker_id, starts_on);
create index leave_records_dates_idx on leave_records(tenant_id, starts_on, ends_on) where status in ('requested', 'approved');

alter table leave_records enable row level security;
create policy tenant_isolation on leave_records using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on leave_records from crop_app;
