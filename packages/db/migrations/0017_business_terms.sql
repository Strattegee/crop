-- The words a business uses for CROP's concepts (one set per business). Each concept has a fixed
-- numeric code (see apps/api/src/terms/terms.ts and docs/CODES.md); the code never changes, the words do.
create table business_terms (
  tenant_id uuid not null references tenants(id),
  code int not null check (code between 1000 and 9999),
  singular text not null check (length(trim(singular)) between 1 and 40),
  plural text not null check (length(trim(plural)) between 1 and 40),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (tenant_id, code)
);
alter table business_terms enable row level security;
create policy tenant_isolation on business_terms using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
