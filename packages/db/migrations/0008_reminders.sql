-- Expiry reminders (spec CRD-7) need the office contacts of the current agency.
-- crop_app can't read users directly; this returns the emails of the current agency's owners and admins only.
create function app_agency_office_emails()
returns table (email text)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct u.email from memberships m join users u on u.id = m.user_id
   where m.tenant_id = app_tenant_id() and m.role in ('owner', 'admin')
$$;
revoke execute on function app_agency_office_emails() from public;
grant execute on function app_agency_office_emails() to crop_app;

-- Which expiry items have been included in an office digest, so each is reported once per stage.
create table reminder_marks (
  tenant_id uuid not null references tenants(id),
  mark text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, mark)
);
alter table reminder_marks enable row level security;
create policy tenant_isolation on reminder_marks using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
