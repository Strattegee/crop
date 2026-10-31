-- Agency copies follow the employer's shift (backlog item 8: "other changes to a shift while agencies hold it (times,
-- role, duties) don't reach their copy yet"; the gender request already did, migration 0049).
-- When the employer changes a shift's times, break, role, area or duties:
--  - open copies of open requests for it are brought up to date (with the requirements worked out again, since the
--    role and duties decide them), so nobody is put forward against an old request;
--  - a copy with someone the agency put forward (waiting for approval or booked) is brought up to date too, and marked
--    `notice = 'changed'` so the agency's office is emailed (unless another notice is already waiting, which is sent
--    with the new details anyway).

alter table agency_inbox drop constraint agency_inbox_notice_check;
alter table agency_inbox add constraint agency_inbox_notice_check check (notice in ('booked', 'declined', 'removed', 'pulled_out', 'cancelled', 'changed'));

-- The shift's requirements as an agency sees them (the same as app_agency_deliver works out when sending).
create function app_agency_shift_requirements(p_shift uuid, p_employer uuid, p_agency uuid, p_connection uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from shifts where id = p_shift and tenant_id = p_employer),
  rules as (
    select r.credential_type_id, r.severity::text as sev, null::text as duty
      from credential_requirements r, s
     where r.tenant_id = p_employer and (r.scope = 'all_workers' or r.role = s.role)
    union all
    select dr.credential_type_id, dr.severity::text, d.name
      from shift_duty_links l join shift_duties d on d.id = l.duty_id
      join shift_duty_requirements dr on dr.duty_id = d.id
     where l.shift_id = p_shift
  ), strongest as (
    select x.credential_type_id,
           min(case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end) as lvl,
           (array_agg(x.duty order by case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end, x.duty nulls first))[1] as duty
      from rules x group by x.credential_type_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'requirementId', ct.id,
           'name', ct.name,
           'severity', (array['hard', 'warning', 'optional'])[st.lvl],
           'forDuty', st.duty,
           'credentialTypeId', m.credential_type_id) order by st.lvl, ct.name), '[]')
    from strongest st
    join credential_types ct on ct.id = st.credential_type_id and ct.tenant_id = p_employer and ct.active
    left join agency_credential_maps m on m.tenant_id = p_agency and m.connection_id = p_connection
          and m.employer_credential_type_id = st.credential_type_id
$$;
revoke execute on function app_agency_shift_requirements(uuid, uuid, uuid, uuid) from public;

-- Brings every live copy of one shift up to date. Internal: called by the triggers below.
create function app_agency_copies_follow(p_shift uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shift shifts%rowtype;
  v_area text;
  v_duties text[];
  r record;
begin
  select * into v_shift from shifts where id = p_shift;
  if not found then return; end if;
  select a.name into v_area from areas a where a.id = v_shift.area_id;
  select coalesce(array_agg(d.name order by d.name), '{}') into v_duties
    from shift_duty_links l join shift_duties d on d.id = l.duty_id where l.shift_id = p_shift;
  for r in
    select i.id, i.tenant_id as agency, i.connection_id, i.status, i.placement, i.notice,
           (i.starts_at, i.ends_at, i.break_minutes, i.role, i.area_name, i.duties) is distinct from
           (v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes, v_shift.role, v_area, v_duties) as differs
      from agency_requests q join agency_inbox i on i.request_ref = q.id
     where q.shift_id = p_shift and q.tenant_id = v_shift.tenant_id
       and (i.status = 'open' or i.placement in ('waiting', 'booked'))
  loop
    update agency_inbox set starts_at = v_shift.starts_at, ends_at = v_shift.ends_at, break_minutes = v_shift.break_minutes,
           role = v_shift.role, area_name = v_area, duties = v_duties,
           requirements = app_agency_shift_requirements(p_shift, v_shift.tenant_id, r.agency, r.connection_id),
           notice = case when r.placement in ('waiting', 'booked') and r.differs and r.notice is null then 'changed' else notice end
     where id = r.id;
  end loop;
end $$;
revoke execute on function app_agency_copies_follow(uuid) from public;

create function app_agency_shift_follow() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.starts_at, new.ends_at, new.break_minutes, new.role, new.area_id) is distinct from
     (old.starts_at, old.ends_at, old.break_minutes, old.role, old.area_id) then
    perform app_agency_copies_follow(new.id);
  end if;
  return null;
end $$;
revoke execute on function app_agency_shift_follow() from public;
create trigger shifts_agency_follow after update of starts_at, ends_at, break_minutes, role, area_id on shifts
  for each row execute function app_agency_shift_follow();

create function app_agency_duty_follow() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app_agency_copies_follow(coalesce(new.shift_id, old.shift_id));
  return null;
end $$;
revoke execute on function app_agency_duty_follow() from public;
create trigger shift_duty_links_agency_follow after insert or delete on shift_duty_links
  for each row execute function app_agency_duty_follow();
