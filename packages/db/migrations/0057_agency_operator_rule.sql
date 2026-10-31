-- Agencies are told up front when equipment on a shift needs a licensed operator (backlog item 8: "telling the
-- agency up front when equipment on the shift needs an operator licence"; until now the employer's Needs attention
-- only flagged it after someone was put forward). The operator credential of each piece of equipment booked on the
-- shift is now a must-have in the agency's copy ("needed for <type> operator"), so the agency's people are checked
-- against it like any other must-have. Adding or removing equipment while agencies hold the shift updates their copies.

create or replace function app_agency_shift_requirements(p_shift uuid, p_employer uuid, p_agency uuid, p_connection uuid) returns jsonb
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
    union all
    select et.operator_credential_type_id, 'hard', et.name || ' operator'
      from shift_assignments a join equipment e on e.id = a.equipment_id join equipment_types et on et.id = e.equipment_type_id
     where a.shift_id = p_shift and a.resource_kind = 'equipment' and a.status = 'confirmed' and et.operator_credential_type_id is not null
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

create or replace function app_agency_deliver(p_round uuid, p_how text)
returns table (agency_tenant_id uuid, inbox_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_round agency_request_rounds%rowtype;
  v_req agency_requests%rowtype;
  v_link agency_connections%rowtype;
  v_shift shifts%rowtype;
  v_site facilities%rowtype;
  v_area text;
  v_duties text[];
  v_reqs jsonb;
  v_employer text;
  v_inbox uuid;
  v_when text;
begin
  select * into v_round from agency_request_rounds r where r.id = p_round for update;
  if not found or v_round.sent_at is not null or v_round.skipped_at is not null then
    return;
  end if;
  select * into v_req from agency_requests q where q.id = v_round.request_id;
  select * into v_shift from shifts s where s.id = v_req.shift_id;
  -- Foreign keys don't see row-level security, so make sure the round, request and shift are all the employer's.
  if v_req.tenant_id is distinct from v_round.tenant_id or v_shift.tenant_id is distinct from v_round.tenant_id then
    update agency_request_rounds set skipped_at = now(), skipped_reason = 'Not this business''s request' where id = p_round;
    return;
  end if;
  if v_req.status <> 'open' then
    update agency_request_rounds set skipped_at = now(), skipped_reason = 'The request had closed' where id = p_round;
    return;
  end if;
  select * into v_link from agency_connections c
   where c.tenant_id = v_round.tenant_id and c.connection_id = v_round.connection_id and c.side = 'employer';
  if coalesce(v_link.status, 'ended') <> 'active' then
    update agency_request_rounds set skipped_at = now(),
           skipped_reason = case when coalesce(v_link.status, 'ended') = 'ended' then 'The link has ended'
                                 else 'Still matching your requirements' end
     where id = p_round;
    return;
  end if;
  select * into v_site from facilities f where f.id = v_shift.facility_id;
  select a.name into v_area from areas a where a.id = v_shift.area_id;
  select name into v_employer from tenants where id = v_round.tenant_id;
  select coalesce(array_agg(d.name order by d.name), '{}') into v_duties
    from shift_duty_links l join shift_duties d on d.id = l.duty_id where l.shift_id = v_shift.id;
  -- The shift's requirements (role, duties and, since migration 0057, operators of equipment on it), with this
  -- agency's matched credential types.
  v_reqs := app_agency_shift_requirements(v_shift.id, v_round.tenant_id, v_link.other_tenant_id, v_round.connection_id);

  insert into agency_inbox(tenant_id, connection_id, request_ref, round_ref, employer_name, site_name, site_region, site_timezone,
                           area_name, role, starts_at, ends_at, break_minutes, duties, requirements, note, gender_requested)
  values (v_link.other_tenant_id, v_round.connection_id, v_req.id, v_round.id, v_employer, v_site.name, nullif(concat_ws(' ', v_site.suburb, v_site.state), ''), v_site.timezone,
          v_area, v_shift.role, v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes, v_duties, v_reqs, v_req.note, v_shift.gender_requested)
  returning id into v_inbox;
  update agency_request_rounds set sent_at = now(), sent_how = p_how where id = p_round;
  v_when := to_char(v_shift.starts_at at time zone v_site.timezone, 'Dy DD Mon HH24:MI');
  insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail) values
    (v_round.tenant_id, v_round.connection_id, 'request_sent', nullif(current_setting('app.actor_name', true), ''), v_employer,
     'Request sent for ' || v_shift.role || ', ' || v_site.name || ', ' || v_when),
    (v_link.other_tenant_id, v_round.connection_id, 'request_sent', nullif(current_setting('app.actor_name', true), ''), v_employer,
     'Request received for ' || v_shift.role || ', ' || v_site.name || ', ' || v_when);
  return query select v_link.other_tenant_id, v_inbox;
end
$$;

-- Equipment added to or taken off a shift: agencies' copies follow (their requirements change).
create function app_agency_equipment_follow() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(new.resource_kind, old.resource_kind) = 'equipment' then
    perform app_agency_copies_follow(coalesce(new.shift_id, old.shift_id));
  end if;
  return null;
end $$;
revoke execute on function app_agency_equipment_follow() from public;
create trigger shift_assignments_agency_equipment after insert or update of status on shift_assignments
  for each row execute function app_agency_equipment_follow();

-- As in 0056, and a change of requirements alone (equipment needing an operator added) also tells an agency that has
-- someone put forward.
create or replace function app_agency_copies_follow(p_shift uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shift shifts%rowtype;
  v_area text;
  v_duties text[];
  v_reqs jsonb;
  r record;
begin
  select * into v_shift from shifts where id = p_shift;
  if not found then return; end if;
  select a.name into v_area from areas a where a.id = v_shift.area_id;
  select coalesce(array_agg(d.name order by d.name), '{}') into v_duties
    from shift_duty_links l join shift_duties d on d.id = l.duty_id where l.shift_id = p_shift;
  for r in
    select i.id, i.tenant_id as agency, i.connection_id, i.placement, i.notice, i.requirements,
           (i.starts_at, i.ends_at, i.break_minutes, i.role, i.area_name, i.duties) is distinct from
           (v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes, v_shift.role, v_area, v_duties) as differs
      from agency_requests q join agency_inbox i on i.request_ref = q.id
     where q.shift_id = p_shift and q.tenant_id = v_shift.tenant_id
       and (i.status = 'open' or i.placement in ('waiting', 'booked'))
  loop
    v_reqs := app_agency_shift_requirements(p_shift, v_shift.tenant_id, r.agency, r.connection_id);
    update agency_inbox set starts_at = v_shift.starts_at, ends_at = v_shift.ends_at, break_minutes = v_shift.break_minutes,
           role = v_shift.role, area_name = v_area, duties = v_duties, requirements = v_reqs,
           notice = case when r.placement in ('waiting', 'booked') and (r.differs or r.requirements is distinct from v_reqs) and r.notice is null
                         then 'changed' else notice end
     where id = r.id;
  end loop;
end $$;
