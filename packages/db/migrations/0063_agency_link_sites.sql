-- Agency links limited to some sites (design note 2026-10-28, `sites`: "which of its sites the agency may fill").
-- Employer side only; null = every site. The API may change it on its own side, like the order and booking mode.
alter table agency_connections add column facility_ids uuid[];
alter table agency_connections add constraint agency_connections_sites_employer
  check (side = 'employer' or facility_ids is null);
alter table agency_connections add constraint agency_connections_sites_not_empty
  check (facility_ids is null or cardinality(facility_ids) > 0);
grant update (facility_ids) on agency_connections to crop_app;

-- As in 0057, and a round for a link that no longer covers the shift's site is skipped instead of delivered
-- (the sites can change while a request is waiting for its later rounds).
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
  if v_link.facility_ids is not null and not (v_shift.facility_id = any(v_link.facility_ids)) then
    update agency_request_rounds set skipped_at = now(), skipped_reason = 'Doesn''t fill this site' where id = p_round;
    return;
  end if;
  select * into v_site from facilities f where f.id = v_shift.facility_id;
  select a.name into v_area from areas a where a.id = v_shift.area_id;
  select name into v_employer from tenants where id = v_round.tenant_id;
  select coalesce(array_agg(d.name order by d.name), '{}') into v_duties
    from shift_duty_links l join shift_duties d on d.id = l.duty_id where l.shift_id = v_shift.id;
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

alter table agency_events drop constraint agency_events_action_check;
alter table agency_events add constraint agency_events_action_check check (action in (
  'invited', 'invite_cancelled', 'linked', 'ended', 'order_changed', 'book_mode_changed', 'matched', 'needs_matching',
  'request_sent', 'request_closed', 'put_forward', 'placement_changed', 'sites_changed'));
