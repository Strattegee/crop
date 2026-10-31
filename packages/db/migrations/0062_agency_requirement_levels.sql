-- The agency seeing which of its people meet an employer's requirements before any shift arrives (David's answer 1
-- on the agency connections design, backlog item 7). app_agency_requirements gives each requirement once, at its
-- strongest level; checking people per role needs the level each role (or everyone, or a duty) asks for it at.
-- Same caller checks as app_agency_requirements: agency side of a live link only. Nothing about the employer's people.
create function app_agency_requirement_levels(p_connection_id uuid)
returns table (requirement_id uuid, kind text, label text, severity text)
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
      select r.credential_type_id, case when r.scope = 'role' then 'role' else 'everyone' end as kind,
             case when r.scope = 'role' then r.role else 'Everyone' end as label, r.severity::text as sev
        from credential_requirements r where r.tenant_id = v_link.other_tenant_id
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
revoke execute on function app_agency_requirement_levels(uuid) from public;
grant execute on function app_agency_requirement_levels(uuid) to crop_app;
