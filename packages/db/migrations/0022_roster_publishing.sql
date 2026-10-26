-- Draft → Live → History (backlog item 2, Steve's answer 5).
-- A site's week is a draft until the office publishes it; once published it is live, and once the week
-- is over (in the site's time zone) it is history. Every change to a shift is written to an append-only
-- change log by triggers, so nothing that touches shifts can skip it (office screens, reply links,
-- demo tools). Changes made after a week was published are marked, so the office can see what changed
-- since the staff were given the roster.

create table roster_publications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null references facilities(id),
  week_start date not null check (extract(isodow from week_start) = 1),
  version int not null check (version >= 1),
  published_by uuid,
  published_by_name text,
  published_at timestamptz not null default now(),
  unique (facility_id, week_start, version)
);
create index roster_publications_week_idx on roster_publications(facility_id, week_start, published_at desc);
alter table roster_publications enable row level security;
create policy tenant_isolation on roster_publications using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on roster_publications from crop_app;

create table shift_changes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id),
  shift_id uuid not null references shifts(id),
  facility_id uuid not null references facilities(id),
  -- The Monday of the shift's local week, so a week's log is one index lookup.
  week_start date not null,
  kind text not null check (kind in ('created', 'assigned', 'booked', 'confirmed', 'unassigned', 'pulled_out',
    'cancelled', 'equipment_added', 'equipment_removed', 'times_changed', 'notes_changed')),
  worker_id uuid references workers(id),
  equipment_id uuid references equipment(id),
  detail text,
  -- True when the week had already been published when the change was made.
  after_publish boolean not null,
  -- Who: set per transaction by the API (app.actor_id / app.actor_name / app.actor_via); null for system changes.
  actor_id uuid,
  actor_name text,
  via text not null default 'office' check (via in ('office', 'link', 'system')),
  at timestamptz not null default now()
);
create index shift_changes_week_idx on shift_changes(facility_id, week_start, at desc);
create index shift_changes_shift_idx on shift_changes(shift_id, at);
alter table shift_changes enable row level security;
create policy tenant_isolation on shift_changes using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on shift_changes from crop_app;

create function app_log_shift_change(p_shift uuid, p_kind text, p_worker uuid, p_equipment uuid, p_detail text)
returns void language plpgsql as $$
declare
  s record;
  wk date;
  actor text := nullif(current_setting('app.actor_id', true), '');
begin
  select sh.tenant_id, sh.facility_id, sh.starts_at, f.timezone into s
    from shifts sh join facilities f on f.id = sh.facility_id where sh.id = p_shift;
  wk := date_trunc('week', s.starts_at at time zone s.timezone)::date;
  insert into shift_changes(tenant_id, shift_id, facility_id, week_start, kind, worker_id, equipment_id, detail,
                            after_publish, actor_id, actor_name, via)
  values (s.tenant_id, p_shift, s.facility_id, wk, p_kind, p_worker, p_equipment, p_detail,
          exists (select 1 from roster_publications p where p.facility_id = s.facility_id and p.week_start = wk),
          case when actor ~* '^[0-9a-f-]{36}$' then actor::uuid end,
          nullif(current_setting('app.actor_name', true), ''),
          coalesce(nullif(current_setting('app.actor_via', true), ''), case when actor is null then 'system' else 'office' end));
end $$;

create function app_shifts_changed() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform app_log_shift_change(new.id, 'created', null, null, null);
  else
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      perform app_log_shift_change(new.id, 'cancelled', null, null, new.cancelled_reason);
    end if;
    if new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.break_minutes <> old.break_minutes then
      perform app_log_shift_change(new.id, 'times_changed', null, null, null);
    end if;
    if new.notes is distinct from old.notes then
      perform app_log_shift_change(new.id, 'notes_changed', null, null, null);
    end if;
  end if;
  return null;
end $$;
create trigger shifts_changed after insert or update on shifts for each row execute function app_shifts_changed();

create function app_shift_assignments_changed() returns trigger language plpgsql as $$
declare
  cancelled boolean;
begin
  if tg_op = 'INSERT' then
    if new.resource_kind = 'equipment' then
      perform app_log_shift_change(new.shift_id, 'equipment_added', null, new.equipment_id, null);
    else
      perform app_log_shift_change(new.shift_id, case when new.status = 'confirmed' then 'booked' else 'assigned' end, new.worker_id, null, null);
    end if;
  elsif new.status <> old.status then
    -- Cancelling a shift removes everyone on it; the 'cancelled' entry already says so.
    select status = 'cancelled' into cancelled from shifts where id = new.shift_id;
    if new.status = 'confirmed' and old.status = 'assigned' then
      perform app_log_shift_change(new.shift_id, 'confirmed', new.worker_id, null, null);
    elsif new.status = 'removed' and not cancelled then
      if new.resource_kind = 'equipment' then
        perform app_log_shift_change(new.shift_id, 'equipment_removed', null, new.equipment_id, null);
      else
        perform app_log_shift_change(new.shift_id, case when new.removed_reason = 'pulled_out' then 'pulled_out' else 'unassigned' end, new.worker_id, null, null);
      end if;
    end if;
  end if;
  return null;
end $$;
create trigger shift_assignments_changed after insert or update on shift_assignments for each row execute function app_shift_assignments_changed();

-- Shifts that existed before the log: one 'created' entry each, so every shift has a start to its history.
insert into shift_changes(tenant_id, shift_id, facility_id, week_start, kind, after_publish, via, at)
select s.tenant_id, s.id, s.facility_id, date_trunc('week', s.starts_at at time zone f.timezone)::date, 'created', false, 'system', s.created_at
  from shifts s join facilities f on f.id = s.facility_id;
