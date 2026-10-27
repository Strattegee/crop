-- Cover rules (from the café demo review, 26 Oct): "whenever anyone is working at this site, at least one of them
-- holds a <credential>", e.g. a food safety supervisor on every shift. A rule with no site applies to every site.
-- Unlike a duty, a cover rule never blocks one person: it is met by the people on shift together, so gaps are shown
-- (Needs attention, the roster) rather than refused.
create table site_cover_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid references facilities(id),
  credential_type_id uuid not null references credential_types(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index site_cover_rules_unique_idx
  on site_cover_rules(tenant_id, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid), credential_type_id);
create index site_cover_rules_type_idx on site_cover_rules(credential_type_id);
alter table site_cover_rules enable row level security;
create policy tenant_isolation on site_cover_rules using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Switched off, never deleted.
revoke delete on site_cover_rules from crop_app;
