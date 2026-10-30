-- Gender requested, carried to agencies (David, 30 Oct; follows migration 0048). When the employer's shift asks for a
-- female or male worker, the agency's copy of the request says so, and the agency's people are checked against it the
-- same way as the employer's own: a different or unrecorded gender is a warning, never a block. Only the request (F or M)
-- crosses businesses; nobody's own gender does.
alter table agency_inbox add column gender_requested text check (gender_requested in ('F', 'M'));

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
  -- The shift's requirements: everyone's and its role's rules, and its duties' rules, each at its strongest level,
  -- with the credential this agency matched it to (null when it hasn't: then nobody meets it).
  with rules as (
    select r.credential_type_id, r.severity::text as sev, null::text as duty
      from credential_requirements r
     where r.tenant_id = v_round.tenant_id and (r.scope = 'all_workers' or r.role = v_shift.role)
    union all
    select dr.credential_type_id, dr.severity::text, d.name
      from shift_duty_links l join shift_duties d on d.id = l.duty_id
      join shift_duty_requirements dr on dr.duty_id = d.id
     where l.shift_id = v_shift.id
  ), strongest as (
    select x.credential_type_id,
           min(case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end) as lvl,
           (array_agg(x.duty order by case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end, x.duty nulls first))[1] as duty
      from rules x group by x.credential_type_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'requirementId', ct.id,
           'name', ct.name,
           'severity', (array['hard', 'warning', 'optional'])[s.lvl],
           'forDuty', s.duty,
           'credentialTypeId', m.credential_type_id) order by s.lvl, ct.name), '[]')
    into v_reqs
    from strongest s
    join credential_types ct on ct.id = s.credential_type_id and ct.tenant_id = v_round.tenant_id and ct.active
    left join agency_credential_maps m on m.tenant_id = v_link.other_tenant_id and m.connection_id = v_round.connection_id
          and m.employer_credential_type_id = s.credential_type_id;

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

-- If the employer changes the request while agencies hold the shift, their open copies follow, so nobody is put
-- forward against an old request. Only open copies of open requests for that shift change; nothing else is touched.
create or replace function app_agency_gender_follow() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.gender_requested is distinct from old.gender_requested then
    update agency_inbox i set gender_requested = new.gender_requested
      from agency_requests q
     where q.shift_id = new.id and q.tenant_id = new.tenant_id and q.status = 'open'
       and i.request_ref = q.id and i.status = 'open';
  end if;
  return null;
end $$;

create trigger shifts_agency_gender after update of gender_requested on shifts
  for each row execute function app_agency_gender_follow();
revoke execute on function app_agency_gender_follow() from public;
