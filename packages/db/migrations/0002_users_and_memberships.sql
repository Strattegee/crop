-- People who sign in (via the identity provider), their roles in each agency, and invitations.
--
-- RLS approach from here on: tables are owned by the migration (owner) role and have row level
-- security ENABLED but not FORCED. crop_app never owns tables, so policies always apply to it,
-- while the owner (migrations, admin tools, and the security definer functions below) can see
-- across agencies. On managed Postgres the owner is not a superuser, so FORCE would block those.
alter table facilities no force row level security;

create type member_role as enum ('owner', 'admin', 'allocator', 'worker', 'client');

-- Platform-level: one row per person, whatever agencies they belong to.
-- crop_app has no direct access; it goes through the security definer functions below.
create table users (
  id uuid primary key default gen_random_uuid(),
  idp_subject text not null unique,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  role member_role not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on memberships(user_id);
alter table memberships enable row level security;
create policy tenant_isolation on memberships
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());

create table invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email text not null check (email = lower(email)),
  role member_role not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references users(id)
);
create unique index invitations_pending_uniq on invitations(tenant_id, email) where accepted_at is null;
alter table invitations enable row level security;
create policy tenant_isolation on invitations
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());

revoke all on users from crop_app;

-- Finds a user by identity provider subject. Returns no row if they have never signed in.
create function app_user_by_subject(p_subject text)
returns table (id uuid, email text, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.email, u.display_name from users u where u.idp_subject = p_subject
$$;

-- Records a sign-in: creates or updates the user and, only when the identity provider
-- has verified the email address, accepts that address's pending invitations.
create function app_sign_in(p_subject text, p_email text, p_email_verified boolean, p_name text)
returns table (id uuid, email text, display_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user users%rowtype;
  v_email text := lower(trim(p_email));
begin
  if p_subject is null or p_subject = '' or v_email is null or v_email = '' then
    raise exception 'subject and email are required';
  end if;
  insert into users (idp_subject, email, display_name)
    values (p_subject, v_email, nullif(trim(p_name), ''))
  on conflict (idp_subject) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, users.display_name),
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

-- The agencies a user belongs to, with their role in each.
create function app_user_memberships(p_user_id uuid)
returns table (tenant_id uuid, tenant_slug text, tenant_name text, role member_role)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.slug, t.name, m.role
  from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id
  order by t.name
$$;

revoke execute on function app_user_by_subject(text) from public;
revoke execute on function app_sign_in(text, text, boolean, text) from public;
revoke execute on function app_user_memberships(uuid) from public;
grant execute on function app_user_by_subject(text) to crop_app;
grant execute on function app_sign_in(text, text, boolean, text) to crop_app;
grant execute on function app_user_memberships(uuid) to crop_app;
