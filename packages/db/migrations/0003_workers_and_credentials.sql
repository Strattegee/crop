-- Workers, credential types, requirement rules and worker credentials (spec WRK-6, CRD-1 to CRD-4, CRD-7).
-- Every table is tenant-owned with the standard RLS policy.

create type worker_status as enum ('active', 'inactive', 'offboarded');
create type credential_category as enum ('registration', 'check', 'training', 'vaccination', 'licence', 'right_to_work');
create type requirement_severity as enum ('hard', 'warning');
create type evidence_status as enum ('missing', 'uploaded');
create type verification_status as enum ('unverified', 'verified', 'rejected');

-- Per-agency settings.
create table tenant_settings (
  tenant_id uuid primary key references tenants(id),
  expiring_window_days int not null default 30 check (expiring_window_days between 1 and 365),
  timezone text not null default 'Australia/Melbourne'
);

create table workers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid references users(id),
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  preferred_name text,
  email text check (email = lower(email)),
  phone text,
  status worker_status not null default 'active',
  -- Roles they can work as, e.g. RN, EN, AIN (classifications come with rate cards).
  roles text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workers_email_uniq on workers(tenant_id, email) where email is not null;
create index workers_tenant_idx on workers(tenant_id, last_name, first_name);

create table credential_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 120),
  category credential_category not null,
  has_number boolean not null default true,
  has_expiry boolean not null default true,
  needs_evidence boolean not null default true,
  -- How the office verifies it, e.g. "Check the AHPRA public register".
  verification_method text,
  -- Optional link that helps verify it (e.g. the public register).
  verification_url text check (verification_url is null or verification_url ~ '^https://'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index credential_types_name_uniq on credential_types(tenant_id, lower(name));

-- Requirement rules (CRD-2). Scopes for client, facility and area arrive with clients and facilities.
create table credential_requirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  credential_type_id uuid not null references credential_types(id),
  scope text not null check (scope in ('all_workers', 'role')),
  role text,
  severity requirement_severity not null default 'hard',
  created_at timestamptz not null default now(),
  check ((scope = 'role') = (role is not null))
);
create unique index credential_requirements_uniq on credential_requirements(tenant_id, credential_type_id, scope, coalesce(role, ''));

create table worker_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  credential_type_id uuid not null references credential_types(id),
  number text,
  issue_date date,
  expiry_date date,
  evidence evidence_status not null default 'missing',
  verification verification_status not null default 'unverified',
  verified_by uuid references users(id),
  verified_at timestamptz,
  verification_note text,
  rejection_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date),
  check ((verification = 'rejected') = (rejection_reason is not null))
);
create index worker_credentials_worker_idx on worker_credentials(tenant_id, worker_id);
create index worker_credentials_expiry_idx on worker_credentials(tenant_id, expiry_date);

-- Full history of each credential (CRD-3).
create table credential_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_credential_id uuid not null references worker_credentials(id),
  at timestamptz not null default now(),
  actor_user_id uuid references users(id),
  action text not null check (action in ('created', 'updated', 'verified', 'rejected', 'verification_reset')),
  details jsonb not null default '{}'
);
create index credential_events_cred_idx on credential_events(tenant_id, worker_credential_id, at);

do $$
declare t text;
begin
  foreach t in array array['tenant_settings', 'workers', 'credential_types', 'credential_requirements', 'worker_credentials', 'credential_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;

-- History is append-only for the API.
revoke update, delete on credential_events from crop_app;
