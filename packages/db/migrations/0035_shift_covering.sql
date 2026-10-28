-- The "T" line on a roster card (Steve, 26 Oct): the person a shift is covering, e.g. someone on leave.
-- Shown as "Covering <name>"; never the kind of leave. Setting or clearing it is a shift change, so it is logged
-- (and follows the after-publishing rule) like any other.
alter table shifts add column covering_worker_id uuid references workers(id);
create index shifts_covering_idx on shifts(covering_worker_id) where covering_worker_id is not null;

alter table shift_changes drop constraint shift_changes_kind_check;
alter table shift_changes add constraint shift_changes_kind_check check (kind in ('created', 'assigned', 'booked', 'confirmed', 'unassigned',
  'pulled_out', 'cancelled', 'equipment_added', 'equipment_removed', 'times_changed', 'notes_changed', 'duty_added', 'duty_removed',
  'covering_set', 'covering_cleared'));

create or replace function app_shifts_changed() returns trigger language plpgsql as $$
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
    if new.covering_worker_id is distinct from old.covering_worker_id then
      if new.covering_worker_id is null then
        perform app_log_shift_change(new.id, 'covering_cleared', old.covering_worker_id, null, null);
      else
        perform app_log_shift_change(new.id, 'covering_set', new.covering_worker_id, null, null);
      end if;
    end if;
  end if;
  return null;
end $$;
