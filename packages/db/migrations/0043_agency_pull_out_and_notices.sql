-- Agency fill, after putting someone forward (backlog item 8):
-- 1. The agency can take its person back (pulled out) before the shift starts. The employer's shift opens again, the
--    roster shows them as pulled out (purple), and the employer's office is emailed.
-- 2. The agency is told by email when the employer approves, declines or takes its person off, or cancels the shift.
--    The employer's change only marks the agency's copy (`notice`); the API's agency timer picks the marks up every
--    minute and emails the agency's owners and admins from the agency's own business.

alter table agency_placements drop constraint agency_placements_status_check;
alter table agency_placements add constraint agency_placements_status_check
  check (status in ('waiting', 'booked', 'declined', 'removed', 'pulled_out', 'cancelled'));
alter table agency_placements add column pulled_out_reason text;

alter table agency_inbox drop constraint agency_inbox_placement_check;
alter table agency_inbox add constraint agency_inbox_placement_check
  check (placement in ('waiting', 'booked', 'declined', 'removed', 'pulled_out', 'cancelled'));
-- A placement change the agency hasn't been emailed about yet (the new placement), cleared when the email is queued.
alter table agency_inbox add column notice text check (notice in ('booked', 'declined', 'removed', 'pulled_out', 'cancelled'));
create index agency_inbox_notice_idx on agency_inbox(placement_at) where notice is not null;

-- As in 0042, plus: someone marked as pulled out (by the agency, or recorded by the employer) is 'pulled_out'; the
-- agency's copy is marked for an email unless the agency made the change itself.
create or replace function app_agency_assignment_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p agency_placements%rowtype;
  v_shift_status text;
  v_new text;
  v_agency uuid;
  v_actor text := nullif(current_setting('app.actor_name', true), '');
  v_by_agency boolean := coalesce(current_setting('app.actor_via', true), '') = 'agency';
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
                  when new.removed_reason = 'pulled_out' then 'pulled_out'
                  when v_p.status = 'waiting' and coalesce(new.removed_reason, 'office') = 'office' then 'declined'
                  else 'removed' end;
  else
    return null;
  end if;
  update agency_placements set status = v_new, decided_at = now(), decided_by_name = v_actor where id = v_p.id;
  select c.other_tenant_id into v_agency from agency_connections c
   where c.tenant_id = v_p.tenant_id and c.connection_id = v_p.connection_id and c.side = 'employer';
  update agency_inbox set placement = v_new, placement_at = now(), notice = case when v_by_agency then null else v_new end
   where id = v_p.inbox_ref and tenant_id = v_agency and request_ref = v_p.request_id;
  v_detail := (select coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name from workers w where w.id = v_p.worker_id)
    || case v_new when 'booked' then ' approved' when 'declined' then ' declined' when 'cancelled' then ': the shift was cancelled'
                  when 'pulled_out' then case when v_by_agency then ' pulled out by the agency' else ' recorded as pulled out' end
                  else ' taken off the shift' end;
  insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail)
    select v_p.tenant_id, v_p.connection_id, 'placement_changed', v_actor,
           (select name from tenants where id = case when v_by_agency then v_agency else v_p.tenant_id end), v_detail
    union all
    select v_agency, v_p.connection_id, 'placement_changed', v_actor,
           (select name from tenants where id = case when v_by_agency then v_agency else v_p.tenant_id end), v_detail
     where v_agency is not null;
  return null;
end
$$;

-- The agency (the calling business, someone in its office) takes back the person it put forward for a request, with
-- an optional reason the employer sees. Only before the shift starts, and only while they are waiting or booked.
-- The employer's shift opens again (the person shows as pulled out); after-publishing rules as for putting forward
-- (refused only when the employer has locked the week).
create function app_agency_pull_out(p_inbox uuid, p_reason text)
returns table (employer_tenant_id uuid, placement_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant_id();
  v_in agency_inbox%rowtype;
  v_mine agency_connections%rowtype;
  v_p agency_placements%rowtype;
  v_a shift_assignments%rowtype;
  v_shift shifts%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 300), '');
  v_actor text := nullif(current_setting('app.actor_name', true), '');
  v_prev_via text := current_setting('app.actor_via', true);
  v_prev_name text := current_setting('app.actor_name', true);
  v_prev_id text := current_setting('app.actor_id', true);
  v_prev_role text := current_setting('app.actor_role', true);
begin
  if v_tenant is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.actor_role', true), '') not in ('owner', 'admin', 'allocator') then
    raise exception 'Only the office can pull someone out.' using errcode = 'CRAG1';
  end if;
  select * into v_in from agency_inbox i where i.id = p_inbox and i.tenant_id = v_tenant for update;
  if not found then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  if v_in.placement is null or v_in.placement not in ('waiting', 'booked') then
    raise exception 'Nobody of yours is on this shift.' using errcode = 'CRAG1';
  end if;
  -- The other side of the link (the employer); the link may have ended since, the placement still stands.
  select * into v_mine from agency_connections c where c.tenant_id = v_tenant and c.connection_id = v_in.connection_id and c.side = 'agency';
  if not found then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  select * into v_p from agency_placements p
   where p.tenant_id = v_mine.other_tenant_id and p.connection_id = v_in.connection_id and p.inbox_ref = p_inbox and p.request_id = v_in.request_ref
   for update;
  if not found then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  if v_p.status not in ('waiting', 'booked') then
    raise exception 'Nobody of yours is on this shift.' using errcode = 'CRAG1';
  end if;
  select * into v_shift from shifts s where s.id = v_p.shift_id and s.tenant_id = v_p.tenant_id for update;
  if not found then
    raise exception 'Request not found' using errcode = 'CRAG2';
  end if;
  if v_shift.starts_at <= clock_timestamp() then
    raise exception 'This shift has already started. Please contact % directly.', v_mine.other_name using errcode = 'CRAG1';
  end if;
  select * into v_a from shift_assignments a where a.id = v_p.assignment_id and a.tenant_id = v_p.tenant_id for update;
  if not found or v_a.status not in ('assigned', 'confirmed') then
    raise exception 'Nobody of yours is on this shift.' using errcode = 'CRAG1';
  end if;

  -- In the employer's shift log this is a change made by the agency.
  perform set_config('app.actor_via', 'agency', true);
  perform set_config('app.actor_name', coalesce(v_actor || ' (' || (select name from tenants where id = v_tenant) || ')', (select name from tenants where id = v_tenant)), true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.actor_role', '', true);

  update agency_placements set pulled_out_reason = v_reason where id = v_p.id;
  update shift_assignments set status = 'removed', ended_at = now(), removed_reason = 'pulled_out' where id = v_a.id;
  update shifts set status = 'open', updated_at = now() where id = v_shift.id and status <> 'cancelled';

  perform set_config('app.actor_via', coalesce(v_prev_via, ''), true);
  perform set_config('app.actor_name', coalesce(v_prev_name, ''), true);
  perform set_config('app.actor_id', coalesce(v_prev_id, ''), true);
  perform set_config('app.actor_role', coalesce(v_prev_role, ''), true);
  return query select v_p.tenant_id, v_p.id;
end
$$;

-- The agency timer (no business selected): which agencies have placement changes to be told about. Ids only.
create function app_agency_placement_notices(p_limit int default 50)
returns table (agency_tenant_id uuid, inbox_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  select i.tenant_id, i.id from agency_inbox i where i.notice is not null
   order by i.placement_at limit greatest(1, least(p_limit, 500));
$$;

-- In the agency's own business: takes the pending notice on one of its requests (returns it and clears it), in the
-- same transaction that queues the email, so a notice is never lost or sent twice.
create function app_agency_take_notice(p_inbox uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_notice text;
begin
  if app_tenant_id() is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  select notice into v_notice from agency_inbox where id = p_inbox and tenant_id = app_tenant_id() and notice is not null for update skip locked;
  if v_notice is null then
    return null;
  end if;
  update agency_inbox set notice = null where id = p_inbox;
  return v_notice;
end
$$;

revoke execute on function app_agency_pull_out(uuid, text) from public;
revoke execute on function app_agency_placement_notices(int) from public;
revoke execute on function app_agency_take_notice(uuid) from public;
grant execute on function app_agency_pull_out(uuid, text) to crop_app;
grant execute on function app_agency_placement_notices(int) to crop_app;
grant execute on function app_agency_take_notice(uuid) to crop_app;
