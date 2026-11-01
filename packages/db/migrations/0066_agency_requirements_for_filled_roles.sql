-- An agency limited to some roles (migration 0065) no longer has to match requirements that only apply to roles it
-- doesn't fill. Rules for one role count only when the link fills that role (or every role); rules for everyone,
-- duties, cover rules and equipment operators still count, since any shift it fills can carry them.
-- Same caller checks as before (migrations 0039, 0046, 0062). Nothing about the employer's people.

-- The roles a link fills, from the employer's row (null = every role). Internal: only called by the functions below,
-- which have already checked the caller is a party to the link.
create function app_agency_filled_roles(p_connection_id uuid)
returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select c.roles from agency_connections c where c.connection_id = p_connection_id and c.side = 'employer'
$$;
revoke execute on function app_agency_filled_roles(uuid) from public;

create or replace function app_agency_requirements(p_connection_id uuid)
returns table (requirement_id uuid, name text, catalogue_code text, category text, has_expiry boolean,
               severity text, needed_for text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_link agency_connections := app_agency_link(p_connection_id);
  v_roles text[];
begin
  if v_link.side <> 'agency' then
    raise exception 'Only the agency matches requirements.' using errcode = 'CRAG1';
  end if;
  if v_link.status = 'ended' then
    raise exception 'This link has ended.' using errcode = 'CRAG1';
  end if;
  v_roles := app_agency_filled_roles(p_connection_id);
  return query
    with rules as (
      select r.credential_type_id, r.severity::text as sev,
             case when r.scope = 'role' then r.role else 'Everyone' end as label
        from credential_requirements r
       where r.tenant_id = v_link.other_tenant_id
         and (r.scope <> 'role' or v_roles is null or r.role = any(v_roles))
      union all
      select dr.credential_type_id, dr.severity, d.name || ' (duty)'
        from shift_duty_requirements dr join shift_duties d on d.id = dr.duty_id
       where dr.tenant_id = v_link.other_tenant_id and d.active
      union all
      select c.credential_type_id, 'optional', 'Cover at ' || coalesce(f.name, 'every site')
        from site_cover_rules c left join facilities f on f.id = c.facility_id
       where c.tenant_id = v_link.other_tenant_id and c.active
      union all
      select et.operator_credential_type_id, 'optional', et.name || ' operator'
        from equipment_types et
       where et.tenant_id = v_link.other_tenant_id and et.active and et.operator_credential_type_id is not null
    )
    select ct.id, ct.name, ct.catalogue_code, ct.category::text, ct.has_expiry,
           (array['hard', 'warning', 'optional'])[min(case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end)],
           array_agg(distinct x.label order by x.label)
      from rules x join credential_types ct on ct.id = x.credential_type_id and ct.tenant_id = v_link.other_tenant_id and ct.active
     group by ct.id, ct.name, ct.catalogue_code, ct.category, ct.has_expiry
     order by min(case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end), ct.name;
end
$$;

create or replace function app_agency_unmatched(p_connection_id uuid)
returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_link agency_connections := app_agency_link(p_connection_id);
  v_agency uuid := case when v_link.side = 'agency' then v_link.tenant_id else v_link.other_tenant_id end;
  v_employer uuid := case when v_link.side = 'employer' then v_link.tenant_id else v_link.other_tenant_id end;
  v_roles text[] := app_agency_filled_roles(p_connection_id);
begin
  return (
    with needed as (
      select r.credential_type_id from credential_requirements r
       where r.tenant_id = v_employer and r.severity in ('hard', 'warning')
         and (r.scope <> 'role' or v_roles is null or r.role = any(v_roles))
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

create or replace function app_agency_requirement_levels(p_connection_id uuid)
returns table (requirement_id uuid, kind text, label text, severity text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_link agency_connections := app_agency_link(p_connection_id);
  v_roles text[];
begin
  if v_link.side <> 'agency' then
    raise exception 'Only the agency matches requirements.' using errcode = 'CRAG1';
  end if;
  if v_link.status = 'ended' then
    raise exception 'This link has ended.' using errcode = 'CRAG1';
  end if;
  v_roles := app_agency_filled_roles(p_connection_id);
  return query
    with rules as (
      select r.credential_type_id, case when r.scope = 'role' then 'role' else 'everyone' end as kind,
             case when r.scope = 'role' then r.role else 'Everyone' end as label, r.severity::text as sev
        from credential_requirements r
       where r.tenant_id = v_link.other_tenant_id
         and (r.scope <> 'role' or v_roles is null or r.role = any(v_roles))
      union all
      select dr.credential_type_id, 'duty', d.name, dr.severity
        from shift_duty_requirements dr join shift_duties d on d.id = dr.duty_id
       where dr.tenant_id = v_link.other_tenant_id and d.active
    )
    select ct.id, x.kind, x.label,
           (array['hard', 'warning', 'optional'])[min(case x.sev when 'hard' then 1 when 'warning' then 2 else 3 end)]
      from rules x join credential_types ct on ct.id = x.credential_type_id and ct.tenant_id = v_link.other_tenant_id and ct.active
     group by ct.id, x.kind, x.label
     order by x.kind, x.label, ct.id;
end
$$;
