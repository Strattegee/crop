-- A business's own list of roles (job titles), and which industry templates it has applied.
-- Workers still hold roles as text (workers.roles); this list is what the business offers and
-- what the roster suggests. Templates only ever add; the business then edits freely.

create table business_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 60),
  area text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index business_roles_name_uniq on business_roles(tenant_id, lower(name));

create table industry_pack_applications (
  tenant_id uuid not null references tenants(id),
  pack_id text not null check (pack_id ~ '^[a-z][a-z0-9-]{1,40}$'),
  applied_at timestamptz not null default now(),
  applied_by uuid,
  primary key (tenant_id, pack_id)
);

alter table business_roles enable row level security;
create policy tenant_isolation on business_roles using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table industry_pack_applications enable row level security;
create policy tenant_isolation on industry_pack_applications using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
