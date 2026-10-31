-- Dashboards (David, 31 Oct): each office person lands on a dashboard made for their job focus (Allocator,
-- Compliance, Recruitment; Overview when none is set). Job focus is separate from access (the membership's role)
-- and is set by the business's owner only. The owner also chooses which managers may see cost and charge figures
-- (owners always can). Targets for the dashboard's numbers are the business's own: CROP suggests a value, but a
-- number is only marked on or off target once the business has set one.

create table member_focus (
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  focus text check (focus in ('allocator', 'compliance', 'recruitment', 'overview')),
  sees_costs boolean not null default false,
  set_by uuid references users(id),
  set_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
alter table member_focus enable row level security;
create policy member_focus_tenant on member_focus using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on member_focus from crop_app;

create table dashboard_targets (
  tenant_id uuid not null references tenants(id),
  kpi text not null check (kpi ~ '^[a-z][a-z0-9_]{1,40}$'),
  value numeric(12,2) not null,
  set_by uuid references users(id),
  set_at timestamptz not null default now(),
  primary key (tenant_id, kpi)
);
alter table dashboard_targets enable row level security;
create policy dashboard_targets_tenant on dashboard_targets using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- The business's office people (owners, admins, allocators) with their focus, for the owner's Team screen.
-- crop_app can't read users, so names and emails come through here, for the caller's own business only.
create function app_office_team()
returns table (user_id uuid, name text, email text, role member_role, focus text, sees_costs boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, coalesce(nullif(u.display_name, ''), u.email), u.email, m.role, f.focus, coalesce(f.sees_costs, false)
    from memberships m join users u on u.id = m.user_id
    left join member_focus f on f.tenant_id = m.tenant_id and f.user_id = m.user_id
   where m.tenant_id = app_tenant_id() and m.role in ('owner', 'admin', 'allocator')
   order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, lower(coalesce(nullif(u.display_name, ''), u.email))
$$;
revoke execute on function app_office_team() from public;
grant execute on function app_office_team() to crop_app;
