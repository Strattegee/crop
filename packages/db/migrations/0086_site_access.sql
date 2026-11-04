-- Per-site access (David, 4 Nov 2026, answers to the questions in docs/decisions/2026-11-04-projects.md):
--   1. Both: a new office role, Supervisor, always limited to the sites and projects they are given; and allocators
--      can be limited to chosen sites too (unlimited unless an owner or admin chooses sites for them).
--   2. Supervisors see what relates to the shift (roles, credentials and licences, the person card's work facts), not
--      personal details (contact details, addresses, date of birth, right-to-work details, notes, employment
--      records, the audit log).
--   3. Someone limited still sees the business-wide numbers (Dashboard, Live numbers): the API works those out
--      across every site.
--
-- Enforced in the database, not only on screens: the API sets `app.site_scope` (the person's sites as a uuid array
-- literal, '{}' for none) and `app.member_role` from the signed-in membership (`withTenant`, from the request's
-- store); each site-keyed table gets a second, RESTRICTIVE policy, so a missed filter can't show or change another
-- site's rows. Restrictive policies are ANDed with the tenant policy, so tenant isolation is unchanged. No setting
-- (owners, admins, unlimited allocators, the worker app, reply links, background jobs) = every site, as before.
-- Security definer functions run as the owner (who bypasses row-level security) and are unaffected.

alter type member_role add value if not exists 'supervisor';

-- Which sites (and projects, which are sites) an office person works on. Set by owners and admins, replaced as a
-- set (like member_offices). An allocator with rows is limited to them; a supervisor always is (no rows = nothing).
-- Owners and admins are never limited (rows for them are ignored, and the API refuses to add any).
create table member_sites (
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  facility_id uuid not null references facilities(id),
  set_by uuid references users(id),
  set_at timestamptz not null default now(),
  primary key (tenant_id, user_id, facility_id)
);
create index member_sites_facility_idx on member_sites(facility_id);
alter table member_sites enable row level security;
create policy tenant_isolation on member_sites using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create trigger member_sites_audit after insert or update or delete on member_sites for each row execute function app_audit();

-- The sites the current request may use: null = every site (no limit set); otherwise the list (maybe empty).
create function app_site_scope() returns uuid[] language sql stable as $$
  select case when coalesce(current_setting('app.site_scope', true), '') = '' then null
              else current_setting('app.site_scope', true)::uuid[] end
$$;

-- A site the current request may use.
create function app_site_ok(p_facility uuid) returns boolean language sql stable as $$
  select app_site_scope() is null or p_facility = any(app_site_scope())
$$;

-- The request is a supervisor's (personal details stay out of reach).
create function app_is_supervisor() returns boolean language sql stable as $$
  select coalesce(current_setting('app.member_role', true), '') = 'supervisor'
$$;

-- Site-keyed tables.
create policy site_scope on facilities as restrictive using (app_site_ok(id)) with check (app_site_ok(id));
create policy site_scope on areas as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on shifts as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on roster_publications as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on roster_templates as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on client_orders as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on site_members as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on equipment_site_allocations as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on stock_movements as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on shift_changes as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
create policy site_scope on roster_change_requests as restrictive using (app_site_ok(facility_id)) with check (app_site_ok(facility_id));
-- Business-wide rows (no site) stay visible; a site's own rows only to people on that site.
create policy site_scope on shift_codes as restrictive
  using (facility_id is null or app_site_ok(facility_id)) with check (facility_id is null or app_site_ok(facility_id));
create policy site_scope on site_cover_rules as restrictive
  using (facility_id is null or app_site_ok(facility_id)) with check (facility_id is null or app_site_ok(facility_id));

-- Shift-keyed tables: allowed when the shift is (its own policies apply: tenant and site). Written out rather than
-- as a function, which Postgres can't inline (it has a subquery), so plans stay as cheap as before for everyone.
create policy site_scope on shift_assignments as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on shift_offers as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on shift_duty_links as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on agency_requests as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on agency_placements as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on allocation_presence as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on client_order_confirmations as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on client_order_notices as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on outside_agency_emails as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on shift_swaps as restrictive
  using (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on call_logs as restrictive
  using (shift_id is null or app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id))
  with check (shift_id is null or app_site_scope() is null or exists (select 1 from shifts s where s.id = shift_id));
create policy site_scope on agency_request_rounds as restrictive
  using (app_site_scope() is null or exists (select 1 from agency_requests r where r.id = request_id))
  with check (app_site_scope() is null or exists (select 1 from agency_requests r where r.id = request_id));

-- Template rows: allowed when their template (and so its site) is.
create policy site_scope on roster_template_shifts as restrictive
  using (app_site_scope() is null or exists (select 1 from roster_templates t where t.id = template_id))
  with check (app_site_scope() is null or exists (select 1 from roster_templates t where t.id = template_id));
create policy site_scope on roster_template_equipment as restrictive
  using (app_site_scope() is null or exists (select 1 from roster_template_shifts x where x.id = template_shift_id))
  with check (app_site_scope() is null or exists (select 1 from roster_template_shifts x where x.id = template_shift_id));
create policy site_scope on roster_template_duties as restrictive
  using (app_site_scope() is null or exists (select 1 from roster_template_shifts x where x.id = template_shift_id))
  with check (app_site_scope() is null or exists (select 1 from roster_template_shifts x where x.id = template_shift_id));

-- Personal details a supervisor never reaches (answer 2), whatever the API asks for. (Not the message log: what a
-- supervisor does may queue messages, e.g. an offer; they have no endpoint that reads it.) Eligibility doesn't read these,
-- so supervisors can still roster; right to work and employment terms stay readable because eligibility needs them,
-- and the API leaves their details out of what supervisors get.
create policy not_supervisor on worker_addresses as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
create policy not_supervisor on audit_log as restrictive using (not app_is_supervisor());
create policy not_supervisor on credential_documents as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
create policy not_supervisor on credential_events as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
create policy not_supervisor on right_to_work_events as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
create policy not_supervisor on call_logs as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
create policy not_supervisor on upload_links as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
create policy not_supervisor on recruitment_events as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());

-- Triggers that must see every site whoever makes the change (they would otherwise miss another site's rows):
-- one piece of equipment is never allocated to two places at once, and someone coming off a shift closes swaps
-- that involve it from either side.
alter function app_equipment_allocation_overlap() security definer set search_path = public, pg_temp;
alter function app_close_swaps_on_removal() security definer set search_path = public, pg_temp;

-- The sign-in guard's lookup (it runs before any tenant is chosen): each business where the person is limited to
-- chosen sites, with those sites. Supervisors always get a row (maybe an empty list); allocators only when sites
-- have been chosen; owners, admins, workers and clients never.
create function app_user_site_limits(p_user uuid)
returns table (tenant_id uuid, facility_ids uuid[])
language sql stable security definer set search_path = public, pg_temp as $$
  select m.tenant_id, coalesce(array_agg(s.facility_id order by s.facility_id) filter (where s.facility_id is not null), '{}')
    from memberships m
    left join member_sites s on s.tenant_id = m.tenant_id and s.user_id = m.user_id
   where m.user_id = p_user and m.role::text in ('allocator', 'supervisor')
   group by m.tenant_id, m.role
  having m.role::text = 'supervisor' or count(s.facility_id) > 0
$$;
revoke execute on function app_user_site_limits(uuid) from public;
grant execute on function app_user_site_limits(uuid) to crop_app;

-- Office people now include supervisors (dashboards' focus, offices, project managers, live numbers' officers).
create or replace function app_office_team()
returns table (user_id uuid, name text, email text, role member_role, focus text, sees_costs boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, coalesce(nullif(u.display_name, ''), u.email), u.email, m.role, f.focus, coalesce(f.sees_costs, false)
    from memberships m join users u on u.id = m.user_id
    left join member_focus f on f.tenant_id = m.tenant_id and f.user_id = m.user_id
   where m.tenant_id = app_tenant_id() and m.role::text in ('owner', 'admin', 'allocator', 'supervisor')
   order by case m.role::text when 'owner' then 0 when 'admin' then 1 when 'allocator' then 2 else 3 end,
            lower(coalesce(nullif(u.display_name, ''), u.email))
$$;

-- Owners and admins switch an office person between allocator and supervisor (Settings › Team access). Owners and
-- admins themselves, workers and clients are changed on the Platform screen only. The audit trigger on memberships
-- records it with the caller (`app.audit_*`). Raises CRAG1 (409) / CRAG2 (404) with plain messages.
create function app_set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old text;
begin
  if coalesce(current_setting('app.actor_role', true), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can change this' using errcode = 'CRAG1';
  end if;
  if p_role not in ('allocator', 'supervisor') then
    raise exception 'Choose allocator or supervisor' using errcode = 'CRAG1';
  end if;
  select m.role::text into v_old from memberships m where m.tenant_id = app_tenant_id() and m.user_id = p_user for update;
  if v_old is null then
    raise exception 'They are not in this business' using errcode = 'CRAG2';
  end if;
  if v_old not in ('allocator', 'supervisor') then
    raise exception 'Only allocators and supervisors can be changed here' using errcode = 'CRAG1';
  end if;
  if v_old <> p_role then
    update memberships set role = p_role::member_role where tenant_id = app_tenant_id() and user_id = p_user;
  end if;
end
$$;
revoke execute on function app_set_member_role(uuid, text) from public;
grant execute on function app_set_member_role(uuid, text) to crop_app;
