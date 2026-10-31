-- Audit log (spec: "Every create, change and delete is written to an audit log with user, time, and old and new
-- values. The log can't be edited."; backlog: "Audit log of office actions (finishes AUTH)").
-- A trigger on every business record table writes one row per insert, update or delete: who (the person signed in,
-- or the link or system that made it), when, and the old and new values of what changed. crop_app can read its own
-- business's rows but can never write, change or delete them: only the trigger (security definer) writes.
-- Who: `app.actor_*` when an endpoint passed an actor (shift changes), else `app.audit_*`, which withTenant sets for
-- every signed-in request. Hashes of link tokens are never copied.
create table audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id),
  at timestamptz not null default clock_timestamp(),
  table_name text not null,
  row_id text,
  -- The person the row is about (the worker's own record, or a row with a worker_id), for their page.
  worker_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  actor_name text,
  via text not null default 'system',
  old_values jsonb,
  new_values jsonb
);
create index audit_log_tenant_at_idx on audit_log(tenant_id, at desc);
create index audit_log_row_idx on audit_log(tenant_id, table_name, row_id, at desc);
create index audit_log_worker_idx on audit_log(tenant_id, worker_id, id desc) where worker_id is not null;
alter table audit_log enable row level security;
create policy audit_log_tenant on audit_log using (tenant_id = app_tenant_id());
revoke insert, update, delete on audit_log from crop_app;
grant select on audit_log to crop_app;

-- Keys never copied into the log, and keys whose change alone isn't worth a row.
create function app_audit_clean(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(p)
   where key not like '%\_hash' and key not in ('updated_at')
$$;

create function app_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then app_audit_clean(to_jsonb(old)) end;
  n jsonb := case when tg_op <> 'DELETE' then app_audit_clean(to_jsonb(new)) end;
  oo jsonb; nn jsonb;
  who text := coalesce(nullif(current_setting('app.actor_id', true), ''), nullif(current_setting('app.audit_id', true), ''));
  who_name text := coalesce(nullif(current_setting('app.actor_name', true), ''), nullif(current_setting('app.audit_name', true), ''));
  how text := coalesce(nullif(current_setting('app.actor_via', true), ''), nullif(current_setting('app.audit_via', true), ''), 'system');
begin
  if tg_op = 'UPDATE' then
    -- Only what changed, both sides.
    select coalesce(jsonb_object_agg(key, o -> key), '{}'::jsonb), coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into oo, nn from jsonb_each(n) where (o -> key) is distinct from value;
    if nn = '{}'::jsonb then return new; end if;
    o := oo; n := nn;
  end if;
  insert into audit_log(tenant_id, table_name, row_id, worker_id, action, actor_id, actor_name, via, old_values, new_values)
  values (coalesce((to_jsonb(new) ->> 'tenant_id')::uuid, (to_jsonb(old) ->> 'tenant_id')::uuid), tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
          case when tg_table_name = 'workers' then coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id')::uuid
               else coalesce(to_jsonb(new) ->> 'worker_id', to_jsonb(old) ->> 'worker_id')::uuid end,
          lower(tg_op),
          case when who ~ '^[0-9a-f-]{36}$' then who::uuid end, left(who_name, 120), left(how, 20), o, n);
  return coalesce(new, old);
end $$;
revoke execute on function app_audit() from public;

-- Every business record table, except the logs and ledgers that are already a history of their own.
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
      join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'tenant_id' and x.table_type = 'BASE TABLE'
       and c.table_name not in ('audit_log', 'agency_events', 'credential_events', 'dashboard_snapshots', 'notifications',
         'platform_admin_events', 'recruitment_events', 'reminder_marks', 'right_to_work_events', 'shift_changes', 'stock_movements')
  loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function app_audit()', t || '_audit', t);
  end loop;
end $$;
