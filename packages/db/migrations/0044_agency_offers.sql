-- Agency fill (backlog item 8): the agency offers a request to several of its own people at once, by email and text
-- with a one-off link each (as bank fill does for an employer's own staff, migration 0014/0016). The first to accept
-- is put forward, with the same checks as the office putting them forward, and goes onto the employer's shift
-- (booked, or waiting for the employer's approval). Offers are agency-side rows only: nothing crosses to the employer
-- until someone accepts.

create table agency_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),          -- the agency
  inbox_id uuid not null references agency_inbox(id),
  worker_id uuid not null references workers(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'filled')),
  expires_at timestamptz,
  link_hash bytea unique,                                   -- SHA-256 of the one-off link's token; the token is never stored
  offered_by uuid,
  offered_by_name text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_via text check (responded_via in ('office', 'link')),
  responded_by_name text
);
create unique index agency_offers_pending_uniq on agency_offers(inbox_id, worker_id) where status = 'pending';
create index agency_offers_inbox_idx on agency_offers(tenant_id, inbox_id);
alter table agency_offers enable row level security;
create policy tenant_isolation on agency_offers using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on agency_offers from crop_app;

-- The public link: which business and offer a link's hash belongs to (nothing else). As app_offer_by_link.
create function app_agency_offer_by_link(p_hash bytea)
returns table (tenant_id uuid, offer_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.tenant_id, o.id from agency_offers o where p_hash is not null and o.link_hash = p_hash
$$;

-- When the agency's copy of a request closes (filled by anyone, withdrawn, expired), its pending offers close too.
create function app_agency_inbox_closed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status <> 'open' and old.status = 'open' then
    update agency_offers set status = case when new.status = 'filled' then 'filled' else 'withdrawn' end, responded_at = now()
     where inbox_id = new.id and tenant_id = new.tenant_id and status = 'pending';
  end if;
  return null;
end
$$;
create trigger agency_inbox_offers after update of status on agency_inbox
  for each row execute function app_agency_inbox_closed();

-- Someone accepts an offer (from their link, or the office records their yes): the agency (the calling business)
-- puts them forward exactly as app_agency_put_forward does, with every check it makes. The pending offer is the
-- permission, so no office role is needed; everything stays within the caller's own offer, request and person.
-- The API re-checks the person against the employer's requirements and the agency's own rules first, in the same
-- transaction.
create function app_agency_accept_offer(p_offer uuid)
returns table (employer_tenant_id uuid, placement_id uuid, booked boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant_id();
  v_o agency_offers%rowtype;
  v_prev_role text := current_setting('app.actor_role', true);
  v_via text := coalesce(nullif(current_setting('app.actor_via', true), ''), 'office');
  r record;
begin
  if v_tenant is null then
    raise exception 'no business selected' using errcode = '42501';
  end if;
  select * into v_o from agency_offers o where o.id = p_offer and o.tenant_id = v_tenant for update;
  if not found then
    raise exception 'Offer not found' using errcode = 'CRAG2';
  end if;
  if v_o.status <> 'pending' then
    raise exception 'This offer is closed.' using errcode = 'CRAG1';
  end if;
  if v_o.expires_at is not null and v_o.expires_at <= clock_timestamp() then
    raise exception 'This offer has expired.' using errcode = 'CRAG1';
  end if;
  -- The office's checks in app_agency_put_forward ask for an office role; the pending offer stands in for it here.
  perform set_config('app.actor_role', 'allocator', true);
  select * into r from app_agency_put_forward(v_o.inbox_id, v_o.worker_id);
  perform set_config('app.actor_role', coalesce(v_prev_role, ''), true);
  -- The request is now filled, which closed every pending offer on it (trigger above); this one was accepted.
  update agency_offers set status = 'accepted', responded_at = now(), responded_via = case when v_via = 'link' then 'link' else 'office' end,
         responded_by_name = nullif(current_setting('app.actor_name', true), '')
   where id = p_offer;
  return query select r.employer_tenant_id, r.placement_id, r.booked;
end
$$;

revoke execute on function app_agency_offer_by_link(bytea) from public;
revoke execute on function app_agency_inbox_closed() from public;
revoke execute on function app_agency_accept_offer(uuid) from public;
grant execute on function app_agency_offer_by_link(bytea) to crop_app;
grant execute on function app_agency_accept_offer(uuid) to crop_app;
