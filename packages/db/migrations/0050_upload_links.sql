-- Upload by link (approved by David 29 Oct): when the office asks a new person for what's still needed, the message
-- carries a one-off link. Through it the person can send photos or files of those credentials (and proof of their
-- right to work, once the office has recorded it), without signing in. Everything sent waits for the office to check.
-- Only a SHA-256 hash of the 256-bit random token is stored. A link works for a few days, until a newer link is sent
-- to the same person, or until the office stops it.
create table upload_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  onboarding_id uuid references worker_onboardings(id),
  link_hash bytea not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index upload_links_worker_idx on upload_links(tenant_id, worker_id, created_at desc);
alter table upload_links enable row level security;
create policy upload_links_tenant on upload_links using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on upload_links from crop_app;

-- The one thing the API can't do inside a tenant: find which business a link belongs to. Exact hash only;
-- whether the link still works is checked by the caller inside withTenant.
create function app_upload_link_by_hash(p_hash bytea)
returns table (tenant_id uuid, link_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.tenant_id, l.id from upload_links l where p_hash is not null and l.link_hash = p_hash
$$;
revoke execute on function app_upload_link_by_hash(bytea) from public;
grant execute on function app_upload_link_by_hash(bytea) to crop_app;
