-- Who can see and change each piece of a person's details (David, 3 Nov 2026, answer 5: "a tab (settings) saying who
-- can input, change or see each piece of information"). The office always sees and changes everything; this says what
-- the person themselves gets in the app: office only (hidden), see, change with the office's approval, or change.
-- Only the business's choices are stored; a field with no row has CROP's default (`FIELD_DEFAULTS` in
-- apps/api/src/workforce/field-access.ts). Set-up, kept by the demo reset; audited.
create table field_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  field text not null check (field in ('name', 'preferred_name', 'email', 'mobile', 'addresses', 'gender')),
  person text not null check (person in ('hidden', 'see', 'approve', 'change')),
  updated_at timestamptz not null default now(),
  unique (tenant_id, field)
);
alter table field_access enable row level security;
create policy tenant_isolation on field_access using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on field_access from crop_app;
create trigger field_access_audit after insert or update or delete on field_access for each row execute function app_audit();
