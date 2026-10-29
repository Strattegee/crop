-- Agency connections (backlog item 7; design docs/decisions/2026-10-28-agency-connections-design.md, approved by
-- David 29 Oct). First slice: linking an employer and an agency, both CROP businesses.
--
-- How a link is made (David's answer 3): the employer's owner or admin creates a one-off invitation link (only a
-- SHA-256 of its token is stored, like offer links) and sends it to the agency; the agency's owner or admin opens
-- it while signed in to CROP and confirms. The link then waits in `matching` until the agency has matched every
-- requirement (David's answer 1, next slice) before it can take requests. Either side can end it.
--
-- Tenancy stays as everywhere else: every table here is fenced by tenant_id = app_tenant_id(). Each side has its
-- own row for a link (same connection_id). The only steps that touch the other business's rows are the security
-- definer functions app_agency_*, which check the caller's business is a party first and write only what the
-- step needs. Every step is logged in agency_events on both sides (append-only).

-- A shared code for credentials that mean the same thing in any business (from the industry templates), so an
-- agency's credential types can be matched to an employer's. Null for credentials a business made up.
alter table credential_types add column catalogue_code text
  check (catalogue_code is null or catalogue_code ~ '^[a-z]{2}\.[a-z0-9][a-z0-9-]{0,79}$');
create unique index credential_types_catalogue_uniq on credential_types(tenant_id, catalogue_code) where catalogue_code is not null;

create table agency_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),       -- the employer that made it
  link_hash bytea not null unique,
  -- Who it was meant for, in the employer's words (shown to the employer only).
  for_name text check (for_name is null or length(for_name) between 1 and 120),
  created_by_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  accepted_at timestamptz,
  accepted_tenant_id uuid references tenants(id),
  connection_id uuid,
  check (accepted_at is null or cancelled_at is null)
);
alter table agency_invitations enable row level security;
create policy tenant_isolation on agency_invitations using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on agency_invitations from crop_app;

create table agency_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  connection_id uuid not null,
  side text not null check (side in ('employer', 'agency')),
  other_tenant_id uuid not null references tenants(id),
  other_name text not null,
  status text not null default 'matching' check (status in ('matching', 'active', 'ended')),
  -- Employer side only: the agency's place in the order requests go out (1 first).
  preference int check (preference between 1 and 99),
  -- Employer side only: book a nominated person straight away, or approve first (pink "accepted" stage).
  book_mode text not null default 'automatic' check (book_mode in ('automatic', 'approve_first')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by_name text,
  ended_by_side text check (ended_by_side in ('employer', 'agency')),
  end_reason text,
  unique (tenant_id, connection_id),
  check (other_tenant_id <> tenant_id),
  check ((status = 'ended') = (ended_at is not null)),
  check (side = 'employer' or preference is null)
);
-- One live link per pair and direction (a business can be both an employer and an agency to the same business).
create unique index agency_connections_live_uniq on agency_connections(tenant_id, other_tenant_id, side) where status <> 'ended';
alter table agency_connections enable row level security;
create policy tenant_isolation on agency_connections using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Rows are only made and ended by the functions below; the API may change its own side's order and booking mode.
revoke insert, update, delete on agency_connections from crop_app;
grant update (preference, book_mode) on agency_connections to crop_app;

create table agency_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id),
  connection_id uuid,
  invitation_id uuid,
  at timestamptz not null default now(),
  action text not null check (action in ('invited', 'invite_cancelled', 'linked', 'ended', 'order_changed', 'book_mode_changed')),
  -- Who did it and from which business (names copied, so the log reads the same after a link ends).
  actor_name text,
  actor_business text,
  detail text
);
create index agency_events_connection_idx on agency_events(tenant_id, connection_id);
alter table agency_events enable row level security;
create policy tenant_isolation on agency_events using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on agency_events from crop_app;

-- The calling business may make or end links only through an owner or admin (the API checks this too; the actor's
-- role is set by withTenant from the signed-in membership).
create function app_agency_caller() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.actor_role', true), '') not in ('owner', 'admin') then
    raise exception 'Only owners and administrators can link businesses.' using errcode = 'CRAG1';
  end if;
  return v_tenant;
end
$$;

-- What the agency sees when it opens an invitation link: the employer's name and whether the link can still be
-- used. Nothing else about the employer. Needs a signed-in business (app_tenant_id) so links can't be probed
-- anonymously.
create function app_agency_invite_preview(p_hash bytea)
returns table (employer_name text, state text, own_business boolean, already_linked boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant_id();
  v_inv agency_invitations%rowtype;
begin
  if v_tenant is null or p_hash is null then
    return;
  end if;
  select * into v_inv from agency_invitations i where i.link_hash = p_hash;
  if not found then
    return;
  end if;
  return query select t.name,
    case when v_inv.accepted_at is not null then 'used'
         when v_inv.cancelled_at is not null then 'cancelled'
         when v_inv.expires_at <= now() then 'expired'
         else 'pending' end,
    v_inv.tenant_id = v_tenant,
    exists (select 1 from agency_connections c where c.tenant_id = v_inv.tenant_id and c.other_tenant_id = v_tenant
              and c.side = 'employer' and c.status <> 'ended')
  from tenants t where t.id = v_inv.tenant_id;
end
$$;

-- The agency (the calling business) confirms an invitation: both sides get their row, in `matching`.
create function app_agency_accept_invite(p_hash bytea)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agency uuid := app_agency_caller();
  v_inv agency_invitations%rowtype;
  v_conn uuid := gen_random_uuid();
  v_employer_name text;
  v_agency_name text;
  v_actor text := nullif(current_setting('app.actor_name', true), '');
  v_pref int;
begin
  select * into v_inv from agency_invitations i where i.link_hash = p_hash for update;
  if not found then
    raise exception 'This link isn''t valid. Check you''ve used the whole link.' using errcode = 'CRAG1';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'This link has already been used.' using errcode = 'CRAG1';
  end if;
  if v_inv.cancelled_at is not null then
    raise exception 'This link was cancelled. Ask for a new one.' using errcode = 'CRAG1';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This link has expired. Ask for a new one.' using errcode = 'CRAG1';
  end if;
  if v_inv.tenant_id = v_agency then
    raise exception 'This link is from your own business. Open it while signed in to the agency''s business.' using errcode = 'CRAG1';
  end if;
  -- Serialise links between the same pair.
  perform pg_advisory_xact_lock(hashtextextended('agency-link:' || v_inv.tenant_id::text || ':' || v_agency::text, 0));
  if exists (select 1 from agency_connections c where c.tenant_id = v_inv.tenant_id and c.other_tenant_id = v_agency
               and c.side = 'employer' and c.status <> 'ended') then
    raise exception 'Your business is already linked with this employer.' using errcode = 'CRAG1';
  end if;
  select name into v_employer_name from tenants where id = v_inv.tenant_id;
  select name into v_agency_name from tenants where id = v_agency;
  select coalesce(max(preference), 0) + 1 into v_pref from agency_connections
    where tenant_id = v_inv.tenant_id and side = 'employer' and status <> 'ended';

  insert into agency_connections(tenant_id, connection_id, side, other_tenant_id, other_name, preference)
    values (v_inv.tenant_id, v_conn, 'employer', v_agency, v_agency_name, least(v_pref, 99));
  insert into agency_connections(tenant_id, connection_id, side, other_tenant_id, other_name)
    values (v_agency, v_conn, 'agency', v_inv.tenant_id, v_employer_name);
  update agency_invitations set accepted_at = now(), accepted_tenant_id = v_agency, connection_id = v_conn where id = v_inv.id;
  insert into agency_events(tenant_id, connection_id, invitation_id, action, actor_name, actor_business, detail) values
    (v_inv.tenant_id, v_conn, v_inv.id, 'linked', v_actor, v_agency_name, v_agency_name || ' accepted the invitation'),
    (v_agency, v_conn, v_inv.id, 'linked', v_actor, v_agency_name, 'Accepted ' || v_employer_name || '''s invitation');
  return v_conn;
end
$$;

-- Either side ends a link (the calling business must be a party). Both rows end; history stays.
create function app_agency_end(p_connection_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_agency_caller();
  v_mine agency_connections%rowtype;
  v_actor text := nullif(current_setting('app.actor_name', true), '');
  v_business text;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 300), '');
begin
  select * into v_mine from agency_connections c where c.tenant_id = v_tenant and c.connection_id = p_connection_id for update;
  if not found then
    raise exception 'Link not found' using errcode = 'CRAG2';
  end if;
  if v_mine.status = 'ended' then
    raise exception 'This link has already ended.' using errcode = 'CRAG1';
  end if;
  select name into v_business from tenants where id = v_tenant;
  update agency_connections set status = 'ended', ended_at = now(), ended_by_name = v_actor, ended_by_side = v_mine.side,
         end_reason = v_reason, preference = null
   where connection_id = p_connection_id and tenant_id in (v_tenant, v_mine.other_tenant_id) and status <> 'ended';
  insert into agency_events(tenant_id, connection_id, action, actor_name, actor_business, detail) values
    (v_tenant, p_connection_id, 'ended', v_actor, v_business, v_reason),
    (v_mine.other_tenant_id, p_connection_id, 'ended', v_actor, v_business, v_reason);
end
$$;

revoke execute on function app_agency_caller() from public;
revoke execute on function app_agency_invite_preview(bytea) from public;
revoke execute on function app_agency_accept_invite(bytea) from public;
revoke execute on function app_agency_end(uuid, text) from public;
grant execute on function app_agency_invite_preview(bytea) to crop_app;
grant execute on function app_agency_accept_invite(bytea) to crop_app;
grant execute on function app_agency_end(uuid, text) to crop_app;
