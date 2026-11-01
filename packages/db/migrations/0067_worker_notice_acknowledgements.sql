-- The worker privacy notice in the app (legal documents follow-up): the first time someone opens the worker app
-- for a business, and again whenever the notice changes, they're shown the worker privacy notice and asked to
-- confirm they've read it. Each confirmation is kept here (which version, when, by which sign-in), so the office can
-- see that the person was told how their information is handled. Append-only: it is its own history, so it has no
-- audit trigger, and crop_app can't change or remove a row.
create table worker_notice_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  notice_version text not null check (length(notice_version) between 1 and 80),
  user_id uuid references users(id),
  acknowledged_at timestamptz not null default now(),
  unique (tenant_id, worker_id, notice_version)
);
create index worker_notice_ack_worker_idx on worker_notice_acknowledgements(tenant_id, worker_id, acknowledged_at desc);
alter table worker_notice_acknowledgements enable row level security;
create policy worker_notice_acknowledgements_tenant on worker_notice_acknowledgements
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on worker_notice_acknowledgements from crop_app;
