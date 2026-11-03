-- The usual person on a shift (David, 3 Nov, answer 2): the grey "T" (template) line on a roster card shows who
-- normally works the shift, and whether they are away that day, so the rosterer isn't building from scratch.
-- A shift made from a template remembers the template's person; a copied week remembers the source shift's
-- usual person (else whoever worked it). The office can set or clear it on the shift panel. It is a record of who
-- normally works it, not a booking: nobody is put on or taken off by it. Logged like covering (migration 0035),
-- so the after-publishing rule applies.
alter table shifts add column usual_worker_id uuid references workers(id);
create index shifts_usual_idx on shifts(usual_worker_id) where usual_worker_id is not null;

alter table shift_changes drop constraint shift_changes_kind_check;
alter table shift_changes add constraint shift_changes_kind_check check (kind in ('created', 'assigned', 'booked', 'confirmed', 'unassigned',
  'pulled_out', 'cancelled', 'equipment_added', 'equipment_removed', 'times_changed', 'notes_changed', 'duty_added', 'duty_removed',
  'covering_set', 'covering_cleared', 'gender_changed', 'role_changed', 'area_changed', 'usual_set', 'usual_cleared'));

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
    if new.usual_worker_id is distinct from old.usual_worker_id then
      if new.usual_worker_id is null then
        perform app_log_shift_change(new.id, 'usual_cleared', old.usual_worker_id, null, null);
      else
        perform app_log_shift_change(new.id, 'usual_set', new.usual_worker_id, null, null);
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
