-- Dashboard history (strategy doc section 5: each number compared with a week ago, and a 13-week trend line):
-- one value per business, measure and day (the business's local date), the latest worked out that day.
-- Written when someone opens a dashboard and by the daily email run, so every measure gets a value each day.
create table dashboard_snapshots (
  tenant_id uuid not null references tenants(id),
  day date not null,
  kpi text not null check (kpi ~ '^[a-z][a-z0-9_]{1,40}$'),
  value numeric(14,2),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, kpi, day)
);
alter table dashboard_snapshots enable row level security;
create policy dashboard_snapshots_tenant on dashboard_snapshots using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on dashboard_snapshots from crop_app;
