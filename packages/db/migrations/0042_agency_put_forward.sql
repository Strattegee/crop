-- Agency fill, next slice (backlog item 8; design docs/decisions/2026-10-28-agency-connections-design.md, build step 3
-- and the approve-first part of step 4): the agency puts one of its people forward for a request; the person goes
-- onto the employer's shift straight away (booked) or waiting for the employer's approval, as the employer chose for
-- that agency (book_mode).
--
-- How the person appears on the employer's roster: an "agency person" row in the employer's own workers table with
-- only the name, the agency's name and an opaque reference to the agency's worker (never usable to reach the
-- agency's data). Status 'agency' keeps them off every list and roster path that looks for 'active' people. Only the
-- functions here create them; crop_app can't create, change or re-status them.
--
-- The agency keeps the result on its copy of the request (placed person, booked / waiting / declined / removed /
-- cancelled) so its Allocations page shows it and its own rostering sees the person as busy then.

-- Not used in this migration: a new enum value can't be used in the same transaction.
alter type worker_status add value if not exists 'agency';

alter table workers add column agency_connection_id uuid;
alter table workers add column agency_worker_ref uuid;
alter table workers add column agency_name text;
alter table workers add constraint workers_agency_ref_check check ((agency_connection_id is null) = (agency_worker_ref is null));
create unique index workers_agency_ref_uniq on workers(tenant_id, agency_connection_id, agency_worker_ref) where agency_connection_id is not null;

-- crop_app (the API) never makes, edits or re-statuses agency people: only the security definer functions below do.
create function app_workers_agency_guard() returns trigger language plpgsql as $$
begin
  if current_user <> 'crop_app' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.agency_connection_id is not null or new.status::text = 'agency' then
      raise exception 'People from an agency are added by the agency' using errcode = 'CRAG1';
    end if;
  elsif old.agency_connection_id is not null or old.status::text = 'agency' then
    raise exception 'People from an agency are kept up to date by the agency' using errcode = 'CRAG1';
  elsif new.agency_connection_id is not null or new.agency_worker_ref is not null or new.agency_name is not null or new.status::text = 'agency' then
    raise exception 'People from an agency are added by the agency' using errcode = 'CRAG1';
  end if;
  return new;
end $$;
create trigger workers_agency_guard before insert or update on workers for each row execute function app_workers_agency_guard();

-- Employer side: each person an agency put forward for one of its requests, and what became of it.
create table agency_placements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),          -- the employer
  request_id uuid not null references agency_requests(id),
  connection_id uuid not null,
  agency_name text not null,
  shift_id uuid not null references shifts(id),
  worker_id uuid not null references workers(id),          -- the agency person row
  assignment_id uuid not null references shift_assignments(id),
  inbox_ref uuid not null,                                 -- the agency's copy of the request (opaque)
  status text not null check (status in ('waiting', 'booked', 'declined', 'removed', 'cancelled')),
  put_forward_by_name text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_name text
);
create unique index agency_placements_request_uniq on agency_placements(request_id);
create index agency_placements_shift_idx on agency_placements(tenant_id, shift_id);
create index agency_placements_assignment_idx on agency_placements(assignment_id);
alter table agency_placements enable row level security;
create policy tenant_isolation on agency_placements using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke insert, update, delete on agency_placements from crop_app;

-- Agency side: who it put forward and how it went.
alter table agency_inbox add column placed_worker_id uuid references workers(id);
alter table agency_inbox add column placed_name text;
alter table agency_inbox add column placed_by_name text;
alter table agency_inbox add column placed_at timestamptz;
alter table agency_inbox add column placement text check (placement in ('waiting', 'booked', 'declined', 'removed', 'cancelled'));
alter table agency_inbox add column placement_at timestamptz;
alter table agency_inbox add constraint agency_inbox_placement_check2 check ((placed_worker_id is null) = (placement is null));
create index agency_inbox_placed_idx on agency_inbox(placed_worker_id) where placement in ('waiting', 'booked');

alter table agency_events drop constraint agency_events_action_check;
alter table agency_events add constraint agency_events_action_check check (action in (
  'invited', 'invite_cancelled', 'linked', 'ended', 'order_changed', 'book_mode_changed', 'matched', 'needs_matching',
  'request_sent', 'request_closed', 'put_forward', 'placement_changed'));

-- The shift log knows changes made by an agency.
alter table shift_changes drop constraint shift_changes_via_check;
alter table shift_changes add constraint shift_changes_via_check check (via in ('office', 'link', 'system', 'agency'));

-- After publishing (migration 0024): an agency putting someone forward is like a reply to an offer link: allowed
-- unless the employer has locked published weeks.
create or replace function app_roster_change_refusal(p_facility uuid, p_week date) returns text language plpgsql stable as $$
declare
  rule text;
  via text := nullif(current_setting('app.actor_via', true), '');
  actor_role text := nullif(current_setting('app.actor_role', true), '');
begin
  if not exists (select 1 from roster_publications p where p.facility_id = p_facility and p.week_start = p_week) then
    return null;
  end if;
  select ts.published_changes into rule from tenant_settings ts join facilities f on f.tenant_id = ts.tenant_id where f.id = p_facility;
  rule := coalesce(rule, 'open');
  if rule = 'open' or via is null or via = 'system' then
    return null;
  end if;
  if via = 'link' then
    if rule = 'locked' then
      return 'This roster can''t be changed now. Please contact the office.';
    end if;
    return null;
  end if;
  if via = 'agency' then
    if rule = 'locked' then
      return 'The employer has locked this week''s roster, so nobody can be put on this shift now.';
    end if;
    return null;
  end if;
  if rule = 'locked' then
    return 'This week''s roster has been published and changes are turned off. An owner or admin can turn them back on in Settings.';
  end if;
  if actor_role in ('owner', 'admin') then
    return null;
  end if;
  return 'This week''s roster has been published, so only an owner or admin can change it.';
end $$;

-- The agency (the calling business, someone in its office) puts one of its active people forward for a request it
-- was sent. The API checks the person against the employer's requirements and the agency's own rules first, in the
-- same transaction. Here: the request is still open on both sides, the link is active on both sides, the shift is
-- still open and hasn't started; then the person goes onto the employer's shift (booked, or waiting for approval when
-- the employer approves first), and the request closes for every agency as filled.
create function app_agency_put_forward(p_inbox uuid, p_worker uuid)
returns table (employer_tenant_id uuid, placement_id uuid, booked boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant_id();
  v_in agency_inbox%rowtype;
  v_w workers%rowtype;
  v_mine agency_connections%rowtype;
  v_emp agency_connections%rowtype;
  v_req agency_requests%rowtype;
  v_shift shifts%rowtype;
  v_person uuid;
  v_assignment uuid;
  v_place uuid;
  v_auto boolean;
  v_name text;
  v_actor text := nullif(current_setting('app.actor_name', true), '');
  v_agency_business text;
  v_prev_via text := current_setting('app.actor_via', true);
  v_prev_name text := current_setting('app.actor_name', true);
  v_prev_id text := current_setting('app.actor_id', true);
  v_prev_role text := current_setting('app.actor_role', true);
begin
  if v_tenant is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.actor_role', true), '') not in ('owner', 'admin', 'allocator') then
    raise exception 'Only the office can put people forward.' using errcode = 'CRAG1';
  end if;
  select * into v_in from agency_inbox i where i.id = p_inbox and i.tenant_id = v_tenant for update;
  if not found then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  if v_in.placed_worker_id is not null then
    raise exception 'You have already put someone forward for this shift.' using errcode = 'CRAG1';
  end if;
  if v_in.status <> 'open' then
    raise exception '%', 'This request has closed: ' || lower(left(coalesce(v_in.closed_reason, 'closed'), 1)) || substr(coalesce(v_in.closed_reason, 'closed'), 2) || '.' using errcode = 'CRAG1';
  end if;
  select * into v_w from workers w where w.id = p_worker and w.tenant_id = v_tenant for update;
  if not found then
    raise exception 'Person not found' using errcode = 'CRAG2';
  end if;
  if v_w.status::text <> 'active' then
    raise exception 'Only active people can be put forward.' using errcode = 'CRAG1';
  end if;
  select * into v_mine from agency_connections c where c.tenant_id = v_tenant and c.connection_id = v_in.connection_id and c.side = 'agency';
  select * into v_emp from agency_connections c where c.tenant_id = v_mine.other_tenant_id and c.connection_id = v_in.connection_id and c.side = 'employer';
  if coalesce(v_mine.status, 'ended') <> 'active' or coalesce(v_emp.status, 'ended') <> 'active' then
    raise exception 'This link isn''t active, so nobody can be put forward.' using errcode = 'CRAG1';
  end if;
  select * into v_req from agency_requests q where q.id = v_in.request_ref for update;
  if not found or v_req.tenant_id is distinct from v_emp.tenant_id then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  if v_req.status <> 'open' then
    raise exception 'This shift has just been filled or taken back by the employer.' using errcode = 'CRAG1';
  end if;
  select * into v_shift from shifts s where s.id = v_req.shift_id for update;
  if v_shift.tenant_id is distinct from v_emp.tenant_id then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  if v_shift.status <> 'open' or not v_shift.needs_person then
    raise exception 'Someone is already on this shift.' using errcode = 'CRAG1';
  end if;
  if v_shift.starts_at <= clock_timestamp() then
    raise exception 'This shift has already started.' using errcode = 'CRAG1';
  end if;

  v_auto := v_emp.book_mode = 'automatic';
  v_name := coalesce(v_w.preferred_name, v_w.first_name) || ' ' || v_w.last_name;
  select name into v_agency_business from tenants where id = v_tenant;

  -- The employer's row for this person: name and agency only.
  select id into v_person from workers w
   where w.tenant_id = v_emp.tenant_id and w.agency_connection_id = v_in.connection_id and w.agency_worker_ref = p_worker;
  if v_person is null then
    insert into workers(tenant_id, first_name, last_name, preferred_name, status, agency_connection_id, agency_worker_ref, agency_name)
    values (v_emp.tenant_id, v_w.first_name, v_w.last_name, v_w.preferred_name, 'agency', v_in.connection_id, p_worker, v_emp.other_name)
    returning id into v_person;
  else
    update workers set first_name = v_w.first_name, last_name = v_w.last_name, preferred_name = v_w.preferred_name,
                       agency_name = v_emp.other_name, updated_at = now()
     where id = v_person;
  end if;

  -- In the employer's shift log this is a change made by the agency (after-publishing rules as for reply links).
  perform set_config('app.actor_via', 'agency', true);
  perform set_config('app.actor_name', coalesce(v_actor || ' (' || v_emp.other_name || ')', v_emp.other_name), true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.actor_role', '', true);

  insert into shift_assignments(tenant_id, shift_id, worker_id, status)
  values (v_emp.tenant_id, v_shift.id, v_person, case when v_auto then 'confirmed' else 'assigned' end::assignment_status)
  returning id into v_assignment;
  insert into agency_placements(tenant_id, request_id, connection_id, agency_name, shift_id, worker_id, assignment_id, inbox_ref, status, put_forward_by_name)
  values (v_emp.tenant_id, v_req.id, v_in.connection_id, v_emp.other_name, v_shift.id, v_person, v_assignment, p_inbox,
          case when v_auto then 'booked' else 'waiting' end, v_actor)
  returning id into v_place;
  update agency_inbox set placed_worker_id = p_worker, placed_name = v_name, placed_by_name = v_actor, placed_at = now(),
         placement = case when v_auto then 'booked' else 'waiting' end, placement_at = now()
   where id = p_inbox;
  -- The shift is filled: its status follows the person (this also closes the request for every agency as filled).
  update shifts set status = (case when v_auto then 'booked' else 'assigned' end)::shift_status, updated_at = now()
   where id = v_shift.id;
  -- Any bank-fill offers the employer had out close as filled.
  update shift_offers set status = 'filled', responded_at = now() where shift_id = v_shift.id and status = 'pending';

  insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail) values
    (v_emp.tenant_id, v_in.connection_id, 'put_forward', v_actor, v_agency_business,
     v_name || ' put forward for ' || v_in.role || ', ' || v_in.site_name || case when v_auto then ' (booked)' else ' (waiting for approval)' end),
    (v_tenant, v_in.connection_id, 'put_forward', v_actor, v_agency_business,
     v_name || ' put forward for ' || v_in.role || ', ' || v_in.site_name || case when v_auto then ' (booked)' else ' (waiting for approval)' end);

  perform set_config('app.actor_via', coalesce(v_prev_via, ''), true);
  perform set_config('app.actor_name', coalesce(v_prev_name, ''), true);
  perform set_config('app.actor_id', coalesce(v_prev_id, ''), true);
  perform set_config('app.actor_role', coalesce(v_prev_role, ''), true);
  return query select v_emp.tenant_id, v_place, v_auto;
end
$$;

-- When the employer approves (confirms), declines or removes an agency person, or cancels the shift, the placement
-- and the agency's copy follow. Runs for any change to an assignment that has a placement.
create function app_agency_assignment_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p agency_placements%rowtype;
  v_shift_status text;
  v_new text;
  v_agency uuid;
  v_actor text := nullif(current_setting('app.actor_name', true), '');
  v_detail text;
begin
  if new.resource_kind <> 'worker' or new.status = old.status then
    return null;
  end if;
  select * into v_p from agency_placements p where p.assignment_id = new.id and p.tenant_id = new.tenant_id and p.status in ('waiting', 'booked') for update;
  if not found then
    return null;
  end if;
  if new.status = 'confirmed' then
    v_new := 'booked';
  elsif new.status = 'removed' then
    select status::text into v_shift_status from shifts where id = new.shift_id;
    v_new := case when v_shift_status = 'cancelled' then 'cancelled'
                  when v_p.status = 'waiting' and coalesce(new.removed_reason, 'office') = 'office' then 'declined'
                  else 'removed' end;
  else
    return null;
  end if;
  update agency_placements set status = v_new, decided_at = now(), decided_by_name = v_actor where id = v_p.id;
  select c.other_tenant_id into v_agency from agency_connections c
   where c.tenant_id = v_p.tenant_id and c.connection_id = v_p.connection_id and c.side = 'employer';
  update agency_inbox set placement = v_new, placement_at = now()
   where id = v_p.inbox_ref and tenant_id = v_agency and request_ref = v_p.request_id;
  v_detail := (select coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name from workers w where w.id = v_p.worker_id)
    || case v_new when 'booked' then ' approved' when 'declined' then ' declined' when 'cancelled' then ': the shift was cancelled' else ' taken off the shift' end;
  insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail)
    select v_p.tenant_id, v_p.connection_id, 'placement_changed', v_actor, (select name from tenants where id = v_p.tenant_id), v_detail
    union all
    select v_agency, v_p.connection_id, 'placement_changed', v_actor, (select name from tenants where id = v_p.tenant_id), v_detail
     where v_agency is not null;
  return null;
end
$$;
create trigger shift_assignments_agency after update of status on shift_assignments
  for each row execute function app_agency_assignment_changed();

revoke execute on function app_agency_put_forward(uuid, uuid) from public;
revoke execute on function app_agency_assignment_changed() from public;
revoke execute on function app_workers_agency_guard() from public;
grant execute on function app_agency_put_forward(uuid, uuid) to crop_app;
