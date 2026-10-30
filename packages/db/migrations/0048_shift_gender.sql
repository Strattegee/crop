-- Gender on the roster (David, 30 Oct). When gender matters it is normally stated by the company asking for the
-- shift (e.g. a client who needs a female carer). The shift records the request (F or M); the person records their
-- gender (F, M or not recorded). A different or unrecorded gender is a warning, never a block: the office decides.
-- The card shows the letter so the rosterer sees it at a glance.
alter table workers add column gender text check (gender in ('F', 'M'));
alter table shifts add column gender_requested text check (gender_requested in ('F', 'M'));
-- Templates and copies carry the request, so a client's standing need isn't lost when a week is copied.
alter table roster_template_shifts add column gender_requested text check (gender_requested in ('F', 'M'));

-- Changing the request is a shift change: logged, and follows the after-publishing rule like any other.
alter table shift_changes drop constraint shift_changes_kind_check;
alter table shift_changes add constraint shift_changes_kind_check check (kind in ('created', 'assigned', 'booked', 'confirmed', 'unassigned',
  'pulled_out', 'cancelled', 'equipment_added', 'equipment_removed', 'times_changed', 'notes_changed', 'duty_added', 'duty_removed',
  'covering_set', 'covering_cleared', 'gender_changed'));

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
  end if;
  return null;
end $$;

-- Shift markers (David, 30 Oct): a "V" on the card when a vehicle is booked, "E" for other equipment. Vehicles are a kind
-- of equipment, so the type says which. Types the industry templates added as vehicles are marked here.
alter table equipment_types add column is_vehicle boolean not null default false;
update equipment_types set is_vehicle = true
 where lower(name) in ('pool car', 'catering van', 'tipper truck', 'delivery van', 'rigid truck (mr)', 'rigid truck (hr)', 'tma truck',
                       'traffic ute', 'arrow board trailer', 'variable message sign (vms) trailer', 'service van', 'patrol car');
