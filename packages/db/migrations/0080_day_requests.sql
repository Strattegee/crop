-- Requests for a day (David, 3 Nov, answer 3: Steve's "R"): a member of staff asks for something on a date in the
-- app, e.g. "AM shift please" or "must finish before 14:00". The office sees them on the roster (R) and in the App
-- requests panel, and marks each done or not possible. They guide; they never block (a shift that breaks one is a
-- warning). The note is the person's own words: the app asks for no health details. Kept on record, never deleted.
create table day_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  on_date date not null,
  kind text not null check (kind in ('prefer_am', 'prefer_pm', 'prefer_night', 'finish_by', 'start_after', 'other')),
  at_time time,
  note text check (note is null or length(note) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'done', 'not_possible', 'withdrawn')),
  created_via text not null default 'app' check (created_via in ('app', 'office')),
  created_by uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  decided_by_name text,
  decided_note text check (decided_note is null or length(decided_note) <= 300),
  check ((kind in ('finish_by', 'start_after')) = (at_time is not null)),
  check (kind <> 'other' or note is not null)
);
create index day_requests_date_idx on day_requests(tenant_id, on_date) where status in ('open', 'done');
create index day_requests_worker_idx on day_requests(worker_id, on_date);
alter table day_requests enable row level security;
create policy tenant_isolation on day_requests using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on day_requests from crop_app;
create trigger day_requests_audit after insert or update or delete on day_requests for each row execute function app_audit();
