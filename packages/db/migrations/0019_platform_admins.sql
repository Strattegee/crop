-- Platform administration (Strattegee staff): add businesses and manage who can sign in to them,
-- from the web instead of the GitHub "invite" workflow.
--
-- Who is a platform admin is granted only by the owner-run tool (invite-cli --platform-admin);
-- the app can never make someone a platform admin. crop_app has no access to these tables and
-- goes through the security definer functions below, each of which checks the caller first.
-- Every change is written to platform_admin_events (append only).

-- Remember whether the identity provider has verified each person's email, so access granted by
-- email only goes straight to accounts that have proved they own it. People who already have access
-- got it through a verified invitation or the owner-run tool, so they count as verified.
alter table users add column email_verified boolean not null default false;
update users set email_verified = true where exists (select 1 from memberships m where m.user_id = users.id);
create index invitations_pending_email_idx on invitations(email) where accepted_at is null;

create or replace function app_sign_in(p_subject text, p_email text, p_email_verified boolean, p_name text)
returns table (id uuid, email text, display_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user users%rowtype;
  v_email text := lower(trim(p_email));
begin
  if p_subject is null or p_subject = '' or v_email is null or v_email = '' then
    raise exception 'subject and email are required';
  end if;
  insert into users (idp_subject, email, display_name, email_verified)
    values (p_subject, v_email, nullif(trim(p_name), ''), coalesce(p_email_verified, false))
  on conflict (idp_subject) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, users.display_name),
        email_verified = excluded.email_verified,
        last_seen_at = now()
  returning * into v_user;

  if p_email_verified then
    insert into memberships (tenant_id, user_id, role)
      select i.tenant_id, v_user.id, i.role from invitations i
      where i.email = v_email and i.accepted_at is null
    on conflict (tenant_id, user_id) do nothing;
    update invitations set accepted_at = now(), accepted_user_id = v_user.id
      where invitations.email = v_email and accepted_at is null;
  end if;

  return query select v_user.id, v_user.email, v_user.display_name;
end
$$;

-- True when an invitation is waiting for this person's email (the guard then refreshes their sign-in,
-- so someone who already belongs to one business picks up a new one without signing out).
create function app_user_has_invite(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from invitations i join users u on u.email = i.email where u.id = p_user and i.accepted_at is null)
$$;

create table platform_admins (
  user_id uuid primary key references users(id),
  granted_at timestamptz not null default now()
);

create table platform_admin_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_user_id uuid not null references users(id),
  tenant_id uuid references tenants(id),
  action text not null check (action in ('create_business', 'invite', 'set_role', 'remove')),
  email text,
  role member_role,
  detail text
);

revoke all on platform_admins from crop_app;
revoke all on platform_admin_events from crop_app;

create function app_is_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from platform_admins where user_id = p_user)
$$;

create function app_platform_check(p_actor uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from platform_admins where user_id = p_actor) then
    raise exception 'not a platform administrator' using errcode = '42501';
  end if;
end
$$;

-- Every business with how many people have access and how many invitations are waiting.
create function app_platform_tenants(p_actor uuid)
returns table (id uuid, slug text, name text, created_at timestamptz, people int, invited int, owners int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app_platform_check(p_actor);
  return query
    select t.id, t.slug, t.name, t.created_at,
           (select count(*)::int from memberships m where m.tenant_id = t.id),
           (select count(*)::int from invitations i where i.tenant_id = t.id and i.accepted_at is null),
           (select count(*)::int from memberships m where m.tenant_id = t.id and m.role = 'owner')
      from tenants t order by t.name;
end
$$;

create function app_platform_create_tenant(p_actor uuid, p_slug text, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform app_platform_check(p_actor);
  insert into tenants(slug, name) values (p_slug, trim(p_name)) returning id into v_id;
  insert into platform_admin_events(actor_user_id, tenant_id, action, detail) values (p_actor, v_id, 'create_business', trim(p_name));
  return v_id;
end
$$;

-- People with access to one business, and invitations not yet used.
create function app_platform_people(p_actor uuid, p_tenant uuid)
returns table (status text, email text, name text, role member_role, since timestamptz, last_seen timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app_platform_check(p_actor);
  return query
    select 'active'::text, u.email, u.display_name, m.role, m.created_at, u.last_seen_at
      from memberships m join users u on u.id = m.user_id where m.tenant_id = p_tenant
    union all
    select 'invited'::text, i.email, null::text, i.role, i.created_at, null::timestamptz
      from invitations i where i.tenant_id = p_tenant and i.accepted_at is null
    order by 1, 2;
end
$$;

-- Gives an email address a role in a business: straight away if they have signed in before,
-- otherwise as an invitation accepted at their first verified sign-in. Also used to change a role.
create function app_platform_invite(p_actor uuid, p_tenant uuid, p_email text, p_role member_role, p_action text default 'invite')
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
  v_old member_role;
begin
  perform app_platform_check(p_actor);
  if not exists (select 1 from tenants where id = p_tenant) then raise exception 'business not found' using errcode = 'P0002'; end if;
  select id into v_user from users where users.email = v_email and users.email_verified order by last_seen_at desc limit 1;
  if v_user is not null then
    select m.role into v_old from memberships m where m.tenant_id = p_tenant and m.user_id = v_user;
    if v_old = 'owner' and p_role <> 'owner'
       and (select count(*) from memberships m where m.tenant_id = p_tenant and m.role = 'owner') = 1 then
      raise exception 'last owner' using errcode = 'P0001', hint = 'last_owner';
    end if;
    insert into memberships(tenant_id, user_id, role) values (p_tenant, v_user, p_role)
      on conflict (tenant_id, user_id) do update set role = excluded.role;
  else
    insert into invitations(tenant_id, email, role) values (p_tenant, v_email, p_role)
      on conflict (tenant_id, email) where accepted_at is null do update set role = excluded.role;
  end if;
  insert into platform_admin_events(actor_user_id, tenant_id, action, email, role)
    values (p_actor, p_tenant, case when p_action = 'set_role' then 'set_role' else 'invite' end, v_email, p_role);
  return case when v_user is null then 'invited' else 'active' end;
end
$$;

-- Takes away someone's access to one business (and any invitation waiting for them).
-- Their account and everything they recorded stay; they can be given access again later.
create function app_platform_remove(p_actor uuid, p_tenant uuid, p_email text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(p_email));
  v_n int := 0;
  v_k int;
begin
  perform app_platform_check(p_actor);
  if exists (select 1 from memberships m join users u on u.id = m.user_id
              where m.tenant_id = p_tenant and u.email = v_email and m.role = 'owner')
     and (select count(*) from memberships m where m.tenant_id = p_tenant and m.role = 'owner') = 1 then
    raise exception 'last owner' using errcode = 'P0001', hint = 'last_owner';
  end if;
  delete from memberships m using users u where m.user_id = u.id and m.tenant_id = p_tenant and u.email = v_email;
  get diagnostics v_n = row_count;
  delete from invitations i where i.tenant_id = p_tenant and i.email = v_email and i.accepted_at is null;
  get diagnostics v_k = row_count;
  if v_n + v_k > 0 then
    insert into platform_admin_events(actor_user_id, tenant_id, action, email) values (p_actor, p_tenant, 'remove', v_email);
  end if;
  return v_n + v_k;
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'app_is_platform_admin(uuid)', 'app_user_has_invite(uuid)', 'app_platform_check(uuid)', 'app_platform_tenants(uuid)',
    'app_platform_create_tenant(uuid, text, text)', 'app_platform_people(uuid, uuid)',
    'app_platform_invite(uuid, uuid, text, member_role, text)', 'app_platform_remove(uuid, uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to crop_app', f);
  end loop;
end $$;
