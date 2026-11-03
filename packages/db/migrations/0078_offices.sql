-- Offices (David, 3 Nov 2026, answer 1): a business's own branches, e.g. "VIC Melbourne Metro", "QLD Sunshine Coast".
-- Each site belongs to at most one office; office people (owners, admins, allocators) can be attached to offices. The
-- allocation queue's chips and the dashboard's live numbers drill down by office (and by the site's state).
-- Switched off, never deleted: sites and history keep pointing at an office that is no longer used.

create table offices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 120),
  -- The office's state or region, optional (a free text like the site's region; checked by the API per country).
  state text check (state is null or length(state) <= 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index offices_tenant_idx on offices(tenant_id);
-- One live office of a name per business (switched-off ones don't count, so a name can be reused).
create unique index offices_live_name on offices(tenant_id, lower(trim(name))) where active;
alter table offices enable row level security;
create policy tenant_isolation on offices using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on offices from crop_app;
create trigger offices_audit after insert or update or delete on offices for each row execute function app_audit();

-- The office a site belongs to (null = no office).
alter table facilities add column office_id uuid references offices(id);
create index facilities_office_idx on facilities(tenant_id, office_id) where office_id is not null;

-- Which offices an office person works in (set by owners and admins, replaced as a set). Someone with offices sees
-- theirs first on Allocations.
create table member_offices (
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  office_id uuid not null references offices(id),
  set_by uuid references users(id),
  set_at timestamptz not null default now(),
  primary key (tenant_id, user_id, office_id)
);
create index member_offices_office_idx on member_offices(office_id);
alter table member_offices enable row level security;
create policy tenant_isolation on member_offices using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create trigger member_offices_audit after insert or update or delete on member_offices for each row execute function app_audit();
