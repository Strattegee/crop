-- Standing teams (David, 5 Nov 2026): groups of people the business keeps together over time, outside any project,
-- e.g. a builder's "Demolition and make good" (2 Carpenter, 2 Plasterer, 1 Painter, 1 Flooring, 1 Labourer). A team
-- has a make-up (how many of each role it needs; role names are the business's, matched exactly like credential
-- rules) and named people, each in one of their roles. The named people are the normal case; the make-up shows which
-- trade is missing when someone is away or leaves. Business-wide (not tied to a site), so no site_scope policy.
-- Not the project team (`site_members`, migration 0084): a later project stage copies a standing team's make-up and
-- people and changes its copy, never the standing team.

create table teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 1000),
  -- Put away instead of deleted: history and later project stages keep pointing at it.
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index teams_tenant_idx on teams(tenant_id);
-- One live team of a name per business (put-away ones don't count, so a name can be reused).
create unique index teams_live_name on teams(tenant_id, lower(trim(name))) where active;
alter table teams enable row level security;
create policy tenant_isolation on teams using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on teams from crop_app;
create trigger teams_audit after insert or update or delete on teams for each row execute function app_audit();

-- The make-up: how many of each role the team needs. Replaced as a set: crop_app can't update a row, a changed line is
-- deleted and inserted again, so the audit log keeps every earlier version.
create table team_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  team_id uuid not null references teams(id),
  role text not null check (length(trim(role)) between 1 and 80),
  count smallint not null check (count between 1 and 99),
  -- The order the office listed them in (shown that way everywhere).
  position smallint not null default 0,
  unique (team_id, role)
);
create index team_roles_team_idx on team_roles(tenant_id, team_id);
alter table team_roles enable row level security;
create policy tenant_isolation on team_roles using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update on team_roles from crop_app;
create trigger team_roles_audit after insert or update or delete on team_roles for each row execute function app_audit();

-- Who is on the team and in which of their roles. Content is never edited: someone who leaves the team gets an end
-- date (`ends_on`, their last day), a mistaken entry is marked `removed_at`; joining again is a new row.
create table team_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  team_id uuid not null references teams(id),
  worker_id uuid not null references workers(id),
  role text not null check (length(trim(role)) between 1 and 80),
  starts_on date not null,
  ends_on date,
  end_reason text check (end_reason is null or length(end_reason) between 1 and 200),
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  check (ends_on is null or ends_on >= starts_on)
);
create index team_members_team_idx on team_members(tenant_id, team_id) where removed_at is null;
create index team_members_worker_idx on team_members(tenant_id, worker_id) where removed_at is null;
-- At most one open place per person and team (they can be in several teams).
create unique index team_members_open on team_members(team_id, worker_id) where removed_at is null and ends_on is null;
alter table team_members enable row level security;
create policy tenant_isolation on team_members using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on team_members from crop_app;
grant update (ends_on, end_reason, removed_at) on team_members to crop_app;
create trigger team_members_audit after insert or update or delete on team_members for each row execute function app_audit();
