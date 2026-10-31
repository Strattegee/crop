-- Changing a shift's role or area (31 Oct, with changing its times): both are shift changes, logged and under the
-- after-publishing rule like any other. Agencies' copies already follow both (migration 0056).
alter table shift_changes drop constraint shift_changes_kind_check;
alter table shift_changes add constraint shift_changes_kind_check check (kind in ('created', 'assigned', 'booked', 'confirmed', 'unassigned',
  'pulled_out', 'cancelled', 'equipment_added', 'equipment_removed', 'times_changed', 'notes_changed', 'duty_added', 'duty_removed',
  'covering_set', 'covering_cleared', 'gender_changed', 'role_changed', 'area_changed'));

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
    if new.gender_requested is distinct from old.gender_requested then
      perform app_log_shift_change(new.id, 'gender_changed', null, null, new.gender_requested);
    end if;
    if new.role is distinct from old.role then
      perform app_log_shift_change(new.id, 'role_changed', null, null, new.role);
    end if;
    if new.area_id is distinct from old.area_id then
      perform app_log_shift_change(new.id, 'area_changed', null, null, (select name from areas where id = new.area_id));
    end if;
  end if;
  return null;
end $$;
