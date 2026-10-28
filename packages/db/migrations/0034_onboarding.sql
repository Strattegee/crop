-- Onboarding checklists (backlog item 11, first slice). A business keeps one or more checklists of what a new
-- person needs before they can work: tasks the office ticks (contract signed, induction done) and steps that tick
-- themselves from the records CROP already keeps (a credential verified and current, right to work checked,
-- employment terms set). Starting onboarding can keep the person off the roster (worker status 'onboarding') until
-- an owner or admin finishes it and makes them active.

-- New worker status. Everything that rosters people already looks for status 'active', so onboarding people are
-- left out without other changes. (Not used in this migration: a new enum value can't be used in the same transaction.)
alter type worker_status add value if not exists 'onboarding';

create table onboarding_checklists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  -- Put away instead of deleted (onboardings point at it).
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index onboarding_checklists_name_idx on onboarding_checklists(tenant_id, lower(name)) where archived_at is null;
alter table onboarding_checklists enable row level security;
create policy tenant_isolation on onboarding_checklists using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on onboarding_checklists from crop_app;

-- The steps of a checklist. Editing the checklist keeps a step's id while it stays; a step taken out is marked
-- removed (ticks recorded against it stay in the history).
create table onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  checklist_id uuid not null references onboarding_checklists(id),
  position int not null,
  title text not null check (length(trim(title)) between 1 and 120),
  help text check (help is null or length(help) <= 300),
  kind text not null check (kind in ('task', 'credential', 'right_to_work', 'employment')),
  credential_type_id uuid references credential_types(id),
  required boolean not null default true,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'credential') = (credential_type_id is not null))
);
create index onboarding_steps_checklist_idx on onboarding_steps(checklist_id, position);
alter table onboarding_steps enable row level security;
create policy tenant_isolation on onboarding_steps using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on onboarding_steps from crop_app;

-- A person going through a checklist. At most one live onboarding per person; finished ones are the history.
create table worker_onboardings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  checklist_id uuid not null references onboarding_checklists(id),
  started_at timestamptz not null default now(),
  started_by uuid references users(id),
  started_by_name text,
  finished_at timestamptz,
  finished_by uuid references users(id),
  finished_by_name text,
  -- completed (everything needed was done) or stopped (not going ahead, with a reason).
  outcome text check (outcome in ('completed', 'stopped')),
  stop_reason text check (stop_reason is null or length(stop_reason) <= 300),
  check ((finished_at is null) = (outcome is null))
);
create unique index worker_onboardings_live_idx on worker_onboardings(worker_id) where finished_at is null;
create index worker_onboardings_checklist_idx on worker_onboardings(checklist_id);
alter table worker_onboardings enable row level security;
create policy tenant_isolation on worker_onboardings using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on worker_onboardings from crop_app;

-- Ticks on task steps, append-only: the latest one for a step says whether it is done.
create table onboarding_ticks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  onboarding_id uuid not null references worker_onboardings(id),
  step_id uuid not null references onboarding_steps(id),
  done boolean not null,
  note text check (note is null or length(note) <= 300),
  by_user uuid references users(id),
  by_name text,
  at timestamptz not null default now()
);
create index onboarding_ticks_onboarding_idx on onboarding_ticks(onboarding_id, step_id, at desc);
alter table onboarding_ticks enable row level security;
create policy tenant_isolation on onboarding_ticks using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on onboarding_ticks from crop_app;
