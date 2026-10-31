-- Agencies not on CROP, second half (backlog item 8; David's answer 4, option 1, in
-- docs/decisions/2026-10-28-agency-connections-design.md): the outside agency replies by email or phone with a name,
-- and the office puts that person on the shift, clearly marked as an unchecked agency worker: CROP hasn't checked
-- their credentials or right to work.
--
-- The person is an "agency person" row in the business's own workers table (status 'agency', name and agency only,
-- like the people CROP agencies put forward in migration 0042), linked to the outside agency instead of a CROP link.
-- crop_app still can't create or change agency people (the guard in 0042 stays as it is): only the function below
-- does, for the calling business and its own outside agencies. Nothing crosses into another business.

alter table workers add column outside_agency_id uuid references outside_agencies(id);
alter table workers add constraint workers_outside_agency_check check (outside_agency_id is null or (agency_connection_id is null and status::text = 'agency'));
create index workers_outside_agency_idx on workers(tenant_id, outside_agency_id) where outside_agency_id is not null;

-- The calling business's office (owner, admin, allocator) finds or adds the person an outside agency named. The same
-- name from the same agency is the same row (so their hours add up on the roster); the agency's current name is kept.
create function app_outside_agency_person(p_agency uuid, p_first text, p_last text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant_id();
  v_agency outside_agencies%rowtype;
  v_first text := btrim(coalesce(p_first, ''));
  v_last text := btrim(coalesce(p_last, ''));
  v_person uuid;
begin
  if v_tenant is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.actor_role', true), '') not in ('owner', 'admin', 'allocator') then
    raise exception 'Only the office can add people from an agency.' using errcode = 'CRAG1';
  end if;
  if length(v_first) not between 1 and 80 or length(v_last) not between 1 and 80 then
    raise exception 'Enter their first and last name.' using errcode = 'CRAG1';
  end if;
  select * into v_agency from outside_agencies a where a.id = p_agency and a.tenant_id = v_tenant;
  if not found then
    raise exception 'Agency not found' using errcode = 'CRAG2';
  end if;
  if not v_agency.active then
    raise exception '%', v_agency.name || ' is switched off.' using errcode = 'CRAG1';
  end if;
  select id into v_person from workers w
   where w.tenant_id = v_tenant and w.outside_agency_id = p_agency
     and lower(w.first_name) = lower(v_first) and lower(w.last_name) = lower(v_last)
   order by w.created_at limit 1
   for update;
  if v_person is null then
    insert into workers(tenant_id, first_name, last_name, status, outside_agency_id, agency_name)
    values (v_tenant, v_first, v_last, 'agency', p_agency, v_agency.name)
    returning id into v_person;
  elsif (select agency_name from workers where id = v_person) is distinct from v_agency.name then
    update workers set agency_name = v_agency.name, updated_at = now() where id = v_person;
  end if;
  return v_person;
end
$$;
revoke execute on function app_outside_agency_person(uuid, text, text) from public;
grant execute on function app_outside_agency_person(uuid, text, text) to crop_app;
