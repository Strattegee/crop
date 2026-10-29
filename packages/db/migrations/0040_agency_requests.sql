-- Agency fill, first slice (backlog items 7–8; design docs/decisions/2026-10-28-agency-connections-design.md, build
-- step 2): the employer presses Agency fill on an open shift; the request goes to its first agency straight away and
-- to the next ones on a timer (David, 26 Oct: starts within 2 hours → 10 minutes between agencies; later the same day
-- → 1 hour; next day or later → 2 hours); each agency sees it in its own list (Allocations).
--
-- Tenancy as everywhere else: every table is fenced by tenant_id = app_tenant_id(). The employer keeps the request
-- and when each agency gets it (agency_requests, agency_request_rounds); each agency keeps its own copy of what it
-- needs to show the request (agency_inbox: site, local times, role, duties, requirements), written only by the
-- security definer functions here, which check the link is live and active first. Nothing about the employer's
-- people crosses over. Nominating and booking come in the next slice.

create table agency_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),         -- the employer
  shift_id uuid not null references shifts(id),
  status text not null default 'open' check (status in ('open', 'filled', 'withdrawn', 'expired')),
  note text check (note is null or length(note) between 1 and 300),
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_reason text,
  check ((status = 'open') = (closed_at is null))
);
create unique index agency_requests_open_uniq on agency_requests(shift_id) where status = 'open';
create index agency_requests_shift_idx on agency_requests(tenant_id, shift_id);
alter table agency_requests enable row level security;
create policy tenant_isolation on agency_requests using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Requests are closed only by the functions below (withdrawn, filled, expired).
revoke insert, update, delete on agency_requests from crop_app;
grant insert (tenant_id, shift_id, note, created_by_name) on agency_requests to crop_app;

-- When each agency gets a request: one row per agency, in the employer's order, with the time it is due.
create table agency_request_rounds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),         -- the employer
  request_id uuid not null references agency_requests(id),
  connection_id uuid not null,
  agency_name text not null,
  position int not null check (position between 1 and 99),
  due_at timestamptz not null,
  sent_at timestamptz,
  sent_how text check (sent_how in ('first', 'timer', 'manual')),
  skipped_at timestamptz,
  skipped_reason text,
  unique (request_id, connection_id),
  unique (request_id, position),
  check (sent_at is null or skipped_at is null)
);
create index agency_request_rounds_due_idx on agency_request_rounds(due_at) where sent_at is null and skipped_at is null;
alter table agency_request_rounds enable row level security;
create policy tenant_isolation on agency_request_rounds using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke insert, update, delete on agency_request_rounds from crop_app;
grant insert (tenant_id, request_id, connection_id, agency_name, position, due_at) on agency_request_rounds to crop_app;
-- The office may bring the next agency forward ("send to the next agency now").
grant update (due_at) on agency_request_rounds to crop_app;

-- The agency's copy of a request it has been sent. Only the functions below write it.
create table agency_inbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),         -- the agency
  connection_id uuid not null,
  request_ref uuid not null,                              -- the employer's request (opaque)
  round_ref uuid not null unique,                         -- the employer's round (opaque)
  employer_name text not null,
  site_name text not null,
  site_region text,                                       -- suburb and state
  site_timezone text not null,
  area_name text,
  role text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes int not null default 0,
  duties text[] not null default '{}',
  -- [{ name, severity: hard|warning|optional, forDuty: text|null, credentialTypeId: <this agency's matched type>|null }]
  requirements jsonb not null default '[]',
  note text,
  status text not null default 'open' check (status in ('open', 'filled', 'withdrawn', 'expired')),
  received_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_reason text,
  check ((status = 'open') = (closed_at is null))
);
create index agency_inbox_open_idx on agency_inbox(tenant_id, starts_at) where status = 'open';
create index agency_inbox_request_idx on agency_inbox(request_ref);
alter table agency_inbox enable row level security;
create policy tenant_isolation on agency_inbox using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke insert, update, delete on agency_inbox from crop_app;

alter table agency_events drop constraint agency_events_action_check;
alter table agency_events add constraint agency_events_action_check check (action in (
  'invited', 'invite_cancelled', 'linked', 'ended', 'order_changed', 'book_mode_changed', 'matched', 'needs_matching',
  'request_sent', 'request_closed'));

-- Sends one round: writes the agency's copy of the request and marks the round sent, or marks it skipped when the
-- request has closed or the link isn't active. Internal (not granted to crop_app). Returns the agency and the new
-- inbox row when it was sent.
create function app_agency_deliver(p_round uuid, p_how text)
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
                           area_name, role, starts_at, ends_at, break_minutes, duties, requirements, note)
  values (v_link.other_tenant_id, v_round.connection_id, v_req.id, v_round.id, v_employer, v_site.name, nullif(concat_ws(' ', v_site.suburb, v_site.state), ''), v_site.timezone,
          v_area, v_shift.role, v_shift.starts_at, v_shift.ends_at, v_shift.break_minutes, v_duties, v_reqs, v_req.note)
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

-- The employer (the calling business, someone in the office) sends whatever is due now on one of its requests:
-- the first agency when the request is made, or the next one when the office brings it forward.
create function app_agency_send_due(p_request uuid, p_how text)
returns table (agency_tenant_id uuid, inbox_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant_id();
  r record;
begin
  if v_tenant is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.actor_role', true), '') not in ('owner', 'admin', 'allocator') then
    raise exception 'Only the office can send requests to agencies.' using errcode = 'CRAG1';
  end if;
  if p_how not in ('first', 'manual') then
    raise exception 'unknown way of sending' using errcode = '22023';
  end if;
  if not exists (select 1 from agency_requests q where q.id = p_request and q.tenant_id = v_tenant) then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  for r in select x.id from agency_request_rounds x
            where x.request_id = p_request and x.tenant_id = v_tenant and x.sent_at is null and x.skipped_at is null and x.due_at <= clock_timestamp()
            order by x.position loop
    return query select * from app_agency_deliver(r.id, p_how);
  end loop;
end
$$;

-- Closes a request and every agency's copy of it; rounds not sent yet are skipped. Internal.
create function app_agency_close_request(p_request uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req agency_requests%rowtype;
begin
  select * into v_req from agency_requests q where q.id = p_request for update;
  if not found or v_req.status <> 'open' then
    return;
  end if;
  update agency_requests set status = p_status, closed_at = now(), closed_reason = p_reason where id = p_request;
  update agency_request_rounds set skipped_at = now(), skipped_reason = 'The request had closed'
   where request_id = p_request and sent_at is null and skipped_at is null;
  update agency_inbox set status = p_status, closed_at = now(), closed_reason = p_reason
   where request_ref = p_request and status = 'open';
  insert into agency_events(tenant_id, connection_id, action, actor_name, detail)
    select i.tenant_id, i.connection_id, 'request_closed', nullif(current_setting('app.actor_name', true), ''), p_reason
      from agency_inbox i where i.request_ref = p_request
    union all
    select v_req.tenant_id, null, 'request_closed', nullif(current_setting('app.actor_name', true), ''), p_reason;
end
$$;

-- The employer's office withdraws one of its requests.
create function app_agency_withdraw_request(p_request uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.actor_role', true), '') not in ('owner', 'admin', 'allocator') then
    raise exception 'Only the office can withdraw requests to agencies.' using errcode = 'CRAG1';
  end if;
  if not exists (select 1 from agency_requests q where q.id = p_request and q.tenant_id = v_tenant) then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  perform app_agency_close_request(p_request, 'withdrawn', coalesce(nullif(left(trim(coalesce(p_reason, '')), 300), ''), 'Withdrawn by the employer'));
end
$$;

-- The timer (the API calls this every minute, no business selected): closes requests whose shift has started, then
-- sends every round that has come due. Only does what is already scheduled; takes no input.
create function app_agency_escalate(p_limit int default 50)
returns table (employer_tenant_id uuid, agency_tenant_id uuid, inbox_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  for r in select q.id from agency_requests q join shifts s on s.id = q.shift_id
            where q.status = 'open' and s.starts_at <= clock_timestamp() loop
    perform app_agency_close_request(r.id, 'expired', 'The shift has started');
  end loop;
  for r in select x.id, x.tenant_id from agency_request_rounds x join agency_requests q on q.id = x.request_id
            where x.sent_at is null and x.skipped_at is null and x.due_at <= clock_timestamp() and q.status = 'open'
            order by x.due_at, x.position limit greatest(1, least(p_limit, 500))
            for update of x skip locked loop
    return query select r.tenant_id, d.agency_tenant_id, d.inbox_id from app_agency_deliver(r.id, 'timer') d;
  end loop;
end
$$;

-- When a shift is filled some other way (someone assigned or booked) or cancelled, its open request closes on both sides.
create function app_agency_shift_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  if new.status is distinct from old.status and new.status in ('assigned', 'booked', 'cancelled') then
    for r in select q.id from agency_requests q where q.shift_id = new.id and q.status = 'open' loop
      perform app_agency_close_request(r.id,
        case when new.status = 'cancelled' then 'withdrawn' else 'filled' end,
        case when new.status = 'cancelled' then 'The shift was cancelled' else 'The shift has been filled' end);
    end loop;
  end if;
  return new;
end
$$;
create trigger shifts_agency_requests after update of status on shifts
  for each row execute function app_agency_shift_changed();

-- When a link ends, the agency's open copies close and rounds not sent yet are skipped.
create function app_agency_link_ended() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'ended' and old.status <> 'ended' then
    if new.side = 'employer' then
      update agency_request_rounds set skipped_at = now(), skipped_reason = 'The link has ended'
       where tenant_id = new.tenant_id and connection_id = new.connection_id and sent_at is null and skipped_at is null;
    else
      update agency_inbox set status = 'withdrawn', closed_at = now(), closed_reason = 'The link has ended'
       where tenant_id = new.tenant_id and connection_id = new.connection_id and status = 'open';
    end if;
  end if;
  return new;
end
$$;
create trigger agency_connections_ended after update of status on agency_connections
  for each row execute function app_agency_link_ended();

revoke execute on function app_agency_deliver(uuid, text) from public;
revoke execute on function app_agency_close_request(uuid, text, text) from public;
revoke execute on function app_agency_send_due(uuid, text) from public;
revoke execute on function app_agency_withdraw_request(uuid, text) from public;
revoke execute on function app_agency_escalate(int) from public;
revoke execute on function app_agency_shift_changed() from public;
revoke execute on function app_agency_link_ended() from public;
grant execute on function app_agency_send_due(uuid, text) to crop_app;
grant execute on function app_agency_withdraw_request(uuid, text) to crop_app;
grant execute on function app_agency_escalate(int) to crop_app;
