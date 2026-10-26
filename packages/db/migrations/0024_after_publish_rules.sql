-- After publishing (backlog item 2, Steve's answer 5): each business chooses what may change once a week's
-- roster has been published.
--   open      anyone in the office can change it; every change is logged (the behaviour until now)
--   managers  only owners and admins can change it; staff replies through offer links still count
--   locked    nobody can change it until an owner or admin turns changes back on
-- The rule is enforced where every change is logged (app_log_shift_change), so no path can skip it.
-- Changes with no person behind them (system jobs, demo tools) are always allowed.

alter table tenant_settings add column published_changes text not null default 'open'
  check (published_changes in ('open', 'managers', 'locked'));

-- Why a change to this site's week would be refused right now, in plain words; null when it is allowed.
-- Reads the person from app.actor_role / app.actor_via (set by withTenant).
create function app_roster_change_refusal(p_facility uuid, p_week date) returns text language plpgsql stable as $$
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
  if rule = 'locked' then
    return 'This week''s roster has been published and changes are turned off. An owner or admin can turn them back on in Settings.';
  end if;
  if actor_role in ('owner', 'admin') then
    return null;
  end if;
  return 'This week''s roster has been published, so only an owner or admin can change it.';
end $$;

create or replace function app_log_shift_change(p_shift uuid, p_kind text, p_worker uuid, p_equipment uuid, p_detail text)
returns void language plpgsql as $$
declare
  s record;
  wk date;
  actor text := nullif(current_setting('app.actor_id', true), '');
  published boolean;
  refusal text;
begin
  select sh.tenant_id, sh.facility_id, sh.starts_at, f.timezone into s
    from shifts sh join facilities f on f.id = sh.facility_id where sh.id = p_shift;
  wk := date_trunc('week', s.starts_at at time zone s.timezone)::date;
  published := exists (select 1 from roster_publications p where p.facility_id = s.facility_id and p.week_start = wk);
  if published then
    refusal := app_roster_change_refusal(s.facility_id, wk);
    if refusal is not null then
      -- CRLK1: the API turns this into a 409 with the message as it is.
      raise exception using errcode = 'CRLK1', message = refusal;
    end if;
  end if;
  insert into shift_changes(tenant_id, shift_id, facility_id, week_start, kind, worker_id, equipment_id, detail,
                            after_publish, actor_id, actor_name, via)
  values (s.tenant_id, p_shift, s.facility_id, wk, p_kind, p_worker, p_equipment, p_detail, published,
          case when actor ~* '^[0-9a-f-]{36}$' then actor::uuid end,
          nullif(current_setting('app.actor_name', true), ''),
          coalesce(nullif(current_setting('app.actor_via', true), ''), case when actor is null then 'system' else 'office' end));
end $$;
