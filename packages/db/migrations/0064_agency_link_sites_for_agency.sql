-- The agency sees which of the employer's sites it fills on a link (design note 2026-10-28: `sites`; migration 0063
-- lets the employer limit a link to some sites). Agency side only, live links only. Returns site names (and region)
-- only, which the agency already receives with each request; nothing else about the employer.
create function app_agency_link_sites(p_connection_id uuid)
returns table (site_name text, site_region text, every_site boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_link agency_connections := app_agency_link(p_connection_id);
  v_emp agency_connections%rowtype;
begin
  if v_link.side <> 'agency' then
    raise exception 'Only the agency asks which sites it fills.' using errcode = 'CRAG1';
  end if;
  if v_link.status = 'ended' then
    return;
  end if;
  select * into v_emp from agency_connections c
   where c.tenant_id = v_link.other_tenant_id and c.connection_id = p_connection_id and c.side = 'employer';
  if not found then
    return;
  end if;
  return query
    select f.name, nullif(concat_ws(' ', f.suburb, f.state), ''), v_emp.facility_ids is null
      from facilities f
     where f.tenant_id = v_emp.tenant_id and (v_emp.facility_ids is null or f.id = any(v_emp.facility_ids))
     order by f.name;
end
$$;

revoke execute on function app_agency_link_sites(uuid) from public;
grant execute on function app_agency_link_sites(uuid) to crop_app;
