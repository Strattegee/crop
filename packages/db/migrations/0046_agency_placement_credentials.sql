-- Agency fill (backlog item 8): people an agency puts forward count for the employer's cover rules and equipment
-- operator checks.
--
-- The employer holds no records for an agency's person, so when the agency puts them forward we keep, on the
-- employer's placement, which of the employer's credential types the agency confirmed they hold on the shift's local
-- date: through the agency's own saved matches (agency_credential_maps), verified and not run out by that date. Only
-- the employer's own credential type ids are kept (no numbers, dates, documents or the agency's records), and only
-- for that one placement.
--
-- So that agencies can match them, the employer's requirements list for an agency now also lists the credentials
-- its cover rules and equipment operators need, as optional (listed, never checked when choosing people), unless a
-- rule already needs them more strongly.

alter table agency_placements add column credential_type_ids uuid[] not null default '{}';

-- Fills credential_type_ids when a placement is made (only app_agency_put_forward makes them; crop_app can't insert).
create function app_agency_placement_credentials() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agency uuid;
  v_ref uuid;
  v_on date;
begin
  select c.tenant_id into v_agency from agency_connections c
   where c.connection_id = new.connection_id and c.side = 'agency' and c.other_tenant_id = new.tenant_id;
  select w.agency_worker_ref into v_ref from workers w where w.id = new.worker_id and w.tenant_id = new.tenant_id;
  select (s.starts_at at time zone f.timezone)::date into v_on
    from shifts s join facilities f on f.id = s.facility_id where s.id = new.shift_id and s.tenant_id = new.tenant_id;
  if v_agency is null or v_ref is null or v_on is null then
    new.credential_type_ids := '{}';
    return new;
  end if;
  new.credential_type_ids := coalesce((
    select array_agg(distinct m.employer_credential_type_id order by m.employer_credential_type_id)
      from agency_credential_maps m
      join credential_types own on own.id = m.credential_type_id and own.tenant_id = v_agency and own.active
      join credential_types emp on emp.id = m.employer_credential_type_id and emp.tenant_id = new.tenant_id
      join worker_credentials wc on wc.credential_type_id = own.id and wc.worker_id = v_ref and wc.tenant_id = v_agency
     where m.tenant_id = v_agency and m.connection_id = new.connection_id
       and wc.verification = 'verified' and (wc.expiry_date is null or wc.expiry_date >= v_on)
  ), '{}');
  return new;
end $$;
revoke execute on function app_agency_placement_credentials() from public;
create trigger agency_placements_credentials before insert on agency_placements
  for each row execute function app_agency_placement_credentials();

-- The employer's requirements on a link (migration 0039), now with cover-rule and operator credentials as optional.
create or replace function app_agency_requirements(p_connection_id uuid)
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
