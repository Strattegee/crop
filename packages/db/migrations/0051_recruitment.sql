-- The recruitment board (David, 31 Oct; backlog item 11): one record from applicant to worker. Applicants are workers
-- with status 'applicant' (so every roster path, which looks for 'active', leaves them out) and a stage on the board.
-- Onboarding and started come from the existing onboarding records. Every move is logged, append-only, for the
-- recruitment dashboard (time in each stage, time to hire).
-- (The new enum value isn't used in this migration: it can't be used in the same transaction.)
alter type worker_status add value if not exists 'applicant';

alter table workers add column recruitment_stage text check (recruitment_stage in ('applied', 'screening', 'interview', 'offer'));
alter table workers add column stage_changed_at timestamptz;

create table recruitment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  at timestamptz not null default now(),
  actor_user_id uuid references users(id),
  actor_name text,
  -- applied / screening / interview / offer / onboarding / started / not_proceeding / reopened
  to_stage text not null check (to_stage in ('applied', 'screening', 'interview', 'offer', 'onboarding', 'started', 'not_proceeding', 'reopened')),
  from_stage text,
  note text check (note is null or length(note) <= 500)
);
create index recruitment_events_worker_idx on recruitment_events(tenant_id, worker_id, at);
alter table recruitment_events enable row level security;
create policy recruitment_events_tenant on recruitment_events using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on recruitment_events from crop_app;
