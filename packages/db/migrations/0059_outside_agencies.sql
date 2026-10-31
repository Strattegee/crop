-- Agencies not on CROP (backlog item 8; David's answer 4 in docs/decisions/2026-10-28-agency-connections-design.md):
-- an employer keeps a list of agencies that don't use CROP and can email one or more of them a shift with
-- everything it needs: the standard requirements for the role, a section of special requirements for this shift
-- (duties, equipment operators, a gender requested), each marked must have / ideal / optional. The agency replies
-- outside CROP. This business's own data only: nothing crosses into another business.
create table outside_agencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(name) between 1 and 120),
  email text not null check (length(email) between 3 and 254),
  phone text check (length(phone) <= 40),
  notes text check (length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index outside_agencies_name_idx on outside_agencies(tenant_id, lower(name));
alter table outside_agencies enable row level security;
create policy tenant_isolation on outside_agencies using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Switched off, never deleted.
revoke delete on outside_agencies from crop_app;
create trigger outside_agencies_audit after insert or update or delete on outside_agencies for each row execute function app_audit();

-- Each email sent: what went to whom and when. Its own history (append-only), so no audit trigger.
create table outside_agency_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  shift_id uuid not null references shifts(id),
  outside_agency_id uuid not null references outside_agencies(id),
  agency_name text not null,
  to_address text not null,
  note text,
  notification_id uuid references notifications(id),
  sent_by_name text,
  sent_at timestamptz not null default now()
);
create index outside_agency_emails_shift_idx on outside_agency_emails(shift_id, sent_at);
create index outside_agency_emails_agency_idx on outside_agency_emails(outside_agency_id);
alter table outside_agency_emails enable row level security;
create policy tenant_isolation on outside_agency_emails using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on outside_agency_emails from crop_app;
