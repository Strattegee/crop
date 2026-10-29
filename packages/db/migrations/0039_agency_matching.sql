-- Agency connections, second slice: matching requirements (David's answer 1, 29 Oct: "The agency need to understand
-- the requirements and match their pool of staff to them ... checked off prior to shifts being required").
--
-- The agency sees the employer's credential requirements (role rules and shift duty rules, with how strongly each is
-- needed) and matches each to one of its own credential types. A shared catalogue code (0038) suggests the match;
-- anything else is matched by hand. The link is active once every must-have and should-have requirement is matched
-- (optional ones never need a match); if the employer adds a requirement later, the link goes back to matching
-- until the agency matches it.
--
-- The matches live on the agency's side. The employer's credential type id is kept only as an opaque reference to
-- the employer's requirement; it can't be used to read anything in the employer's business.

create table agency_credential_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),            -- the agency
  connection_id uuid not null,
  employer_credential_type_id uuid not null,                 -- opaque: the employer's requirement
  employer_type_name text not null,                          -- copied when matched, for the log and lists
  credential_type_id uuid not null references credential_types(id),
  matched_by text not null check (matched_by in ('code', 'hand')),
  matched_by_name text,
  matched_at timestamptz not null default now(),
  unique (tenant_id, connection_id, employer_credential_type_id)
);
create index agency_credential_maps_type_idx on agency_credential_maps(credential_type_id);
alter table agency_credential_maps enable row level security;
create policy tenant_isolation on agency_credential_maps using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

alter table agency_events drop constraint agency_events_action_check;
alter table agency_events add constraint agency_events_action_check check (action in (
  'invited', 'invite_cancelled', 'linked', 'ended', 'order_changed', 'book_mode_changed', 'matched', 'needs_matching'));

-- The calling business's live link with this id, or an error. Either side.
create function app_agency_link(p_connection_id uuid)
returns agency_connections
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_row agency_connections%rowtype;
begin
  if app_tenant_id() is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  select * into v_row from agency_connections c where c.tenant_id = app_tenant_id() and c.connection_id = p_connection_id;
  if not found then
    raise exception 'Link not found' using errcode = 'CRAG2';
  end if;
  return v_row;
end
$$;

-- The employer's credential requirements on a link, one row per credential type, with the strongest level it is
-- needed at and where (roles, duties). Only for the agency side of a live link. Nothing about the employer's people.
create function app_agency_requirements(p_connection_id uuid)
returns table (requirement_id uuid, name text, catalogue_code text, category text, has_expiry boolean,
               severity text, needed_for text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_link agency_connections := app_agency_link(p_connection_id);
begin
  if v_link.side <> 'agency' then
    raise exception 'Only the agency matches requirements.' using errcode = 'CRAG1';
  end if;
  if v_link.status = 'ended' then
    raise exception 'This link has ended.' using errcode = 'CRAG1';
  end if;
  return query
    with rules as (
      select r.credential_type_id, r.severity::text as sev,
             case when r.scope = 'role' then r.role else 'Everyone' end as label
        from credential_requirements r where r.tenant_id = v_link.other_tenant_id
      union all
      select dr.credential_type_id, dr.severity, d.name || ' (duty)'
        from shift_duty_requirements dr join shift_duties d on d.id = dr.duty_id
       where dr.tenant_id = v_link.other_tenant_id and d.active
    )
    select ct.id, ct.name, ct.catalogue_code, ct.category::text, ct.has_expiry,
           (array['hard', 'warning', 'optional'])[min(case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end)],
           array_agg(distinct x.label order by x.label)
      from rules x join credential_types ct on ct.id = x.credential_type_id and ct.tenant_id = v_link.other_tenant_id and ct.active
     group by ct.id, ct.name, ct.catalogue_code, ct.category, ct.has_expiry
     order by min(case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end), ct.name;
end
$$;

-- How many must-have and should-have requirements the agency hasn't matched yet on a link. Either side may ask.
create function app_agency_unmatched(p_connection_id uuid)
returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_link agency_connections := app_agency_link(p_connection_id);
  v_agency uuid := case when v_link.side = 'agency' then v_link.tenant_id else v_link.other_tenant_id end;
  v_employer uuid := case when v_link.side = 'employer' then v_link.tenant_id else v_link.other_tenant_id end;
begin
  return (
    with needed as (
      select r.credential_type_id from credential_requirements r where r.tenant_id = v_employer and r.severity in ('hard', 'warning')
      union
      select dr.credential_type_id from shift_duty_requirements dr join shift_duties d on d.id = dr.duty_id
       where dr.tenant_id = v_employer and d.active and dr.severity in ('hard', 'warning')
    )
    select count(*)::int from needed n
      join credential_types ct on ct.id = n.credential_type_id and ct.tenant_id = v_employer and ct.active
     where not exists (
       select 1 from agency_credential_maps m join credential_types own on own.id = m.credential_type_id and own.active
        where m.tenant_id = v_agency and m.connection_id = p_connection_id and m.employer_credential_type_id = n.credential_type_id));
end
$$;

-- Brings both rows of a live link to `active` when nothing is left to match, or back to `matching` when something
-- is. Logged on both sides when it changes. Returns the status. Either side may call it (no actor role needed: it
-- only reflects the current state of the requirements and matches).
create function app_agency_refresh(p_connection_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link agency_connections := app_agency_link(p_connection_id);
  v_left int;
  v_next text;
begin
  if v_link.status = 'ended' then
    return 'ended';
  end if;
  v_left := app_agency_unmatched(p_connection_id);
  v_next := case when v_left = 0 then 'active' else 'matching' end;
  if v_next <> v_link.status then
    update agency_connections set status = v_next
     where connection_id = p_connection_id and tenant_id in (v_link.tenant_id, v_link.other_tenant_id) and status <> 'ended';
    insert into agency_events(tenant_id, connection_id, action, actor_name, detail)
      select t, p_connection_id, case when v_next = 'active' then 'matched' else 'needs_matching' end,
             nullif(current_setting('app.actor_name', true), ''),
             case when v_next = 'active' then 'Every requirement is matched; requests can be sent'
                  else v_left || ' requirement' || case when v_left = 1 then '' else 's' end || ' to match' end
        from unnest(array[v_link.tenant_id, v_link.other_tenant_id]) t;
  end if;
  return v_next;
end
$$;

revoke execute on function app_agency_link(uuid) from public;
revoke execute on function app_agency_requirements(uuid) from public;
revoke execute on function app_agency_unmatched(uuid) from public;
revoke execute on function app_agency_refresh(uuid) from public;
grant execute on function app_agency_requirements(uuid) to crop_app;
grant execute on function app_agency_unmatched(uuid) to crop_app;
grant execute on function app_agency_refresh(uuid) to crop_app;
