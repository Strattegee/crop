-- Tenancy foundation and row-level security.
-- Every tenant-owned table has tenant_id and the policy pattern used on facilities below.

create extension if not exists pgcrypto;

-- The API connects as crop_app. It has no BYPASSRLS, so policies always apply.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crop_app') then
    create role crop_app nologin;
  end if;
end $$;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

-- Returns the tenant set for the current transaction, or null when none is set.
create function app_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create table facilities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  timezone text not null default 'Australia/Melbourne',
  created_at timestamptz not null default now()
);
create index facilities_tenant_idx on facilities(tenant_id);

alter table facilities enable row level security;
alter table facilities force row level security;
create policy tenant_isolation on facilities
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());

grant usage on schema public to crop_app;
grant select on tenants to crop_app;
grant select, insert, update, delete on facilities to crop_app;
alter default privileges in schema public grant select, insert, update, delete on tables to crop_app;
