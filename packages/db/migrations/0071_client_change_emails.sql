-- Changes and cancellations emailed to the client (backlog: client orders, next step after the booked email).
--
-- Once the client has been emailed who is going (client_order_confirmations), they are told when that stops being
-- true: the shift is cancelled, the person is taken off it (removed or pulled out; never why), or its date, times or
-- area change while the person is still on it. The booked email for whoever goes instead is the existing one.
-- A short settling time (two minutes by default) lets the office finish what it is doing before a change goes out,
-- so a quick fix doesn't become two emails. Cancellations go at once.

-- What the client was told in the booked email (filled for new rows; earlier rows take the shift as it is now).
alter table client_order_confirmations
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column area_id uuid references areas(id);
update client_order_confirmations c set starts_at = s.starts_at, ends_at = s.ends_at, area_id = s.area_id
  from shifts s where s.id = c.shift_id;

-- Each change email sent: its own history (append-only), so no audit trigger. starts_at / ends_at / area_id are what the
-- client is told now (for 'changed'), so the next change compares with them.
create table client_order_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  order_id uuid not null references client_orders(id),
  shift_id uuid not null references shifts(id),
  confirmation_id uuid not null references client_order_confirmations(id),
  kind text not null check (kind in ('cancelled', 'removed', 'changed')),
  starts_at timestamptz,
  ends_at timestamptz,
  area_id uuid references areas(id),
  notification_id uuid references notifications(id),
  sent_at timestamptz not null default now()
);
create index client_order_notices_confirmation_idx on client_order_notices(confirmation_id, sent_at desc);
create index client_order_notices_order_idx on client_order_notices(order_id);
-- One cancellation per shift and one "no longer going" per person told about.
create unique index client_order_notices_cancelled on client_order_notices(shift_id) where kind = 'cancelled';
create unique index client_order_notices_removed on client_order_notices(confirmation_id) where kind = 'removed';
alter table client_order_notices enable row level security;
create policy tenant_isolation on client_order_notices using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on client_order_notices from crop_app;

-- What the client was last told about a confirmation's shift: the booked email, then the latest change email.
create function app_client_told(p_confirmation uuid)
returns table (starts_at timestamptz, ends_at timestamptz, area_id uuid)
language sql stable set search_path = public, pg_temp as $$
  select coalesce(n.starts_at, c.starts_at), coalesce(n.ends_at, c.ends_at), case when n.id is null then c.area_id else n.area_id end
    from client_order_confirmations c
    left join lateral (select x.id, x.starts_at, x.ends_at, x.area_id from client_order_notices x
                        where x.confirmation_id = c.id and x.kind = 'changed' order by x.sent_at desc limit 1) n on true
   where c.id = p_confirmation;
$$;
grant execute on function app_client_told(uuid) to crop_app;

-- The change-email timer (no business selected): ids only; the email is written and checked again in the business.
-- p_settle_seconds: how long since the shift's last change before a removal or change goes (not cancellations).
create function app_client_notices_due(p_settle_seconds int default 120, p_limit int default 50)
returns table (tenant_id uuid, confirmation_id uuid, kind text)
language sql security definer set search_path = public, pg_temp as $$
  with conf as (
    select c.id, c.tenant_id, c.shift_id, c.worker_id, c.sent_at, c.starts_at as told_known,
           s.status, s.starts_at, s.ends_at, s.area_id,
           coalesce((select max(x.at) from shift_changes x where x.shift_id = s.id), s.updated_at)
             <= now() - make_interval(secs => greatest(0, p_settle_seconds)) as settled,
           exists (select 1 from shift_assignments sa where sa.shift_id = s.id and sa.resource_kind = 'worker'
                     and sa.worker_id = c.worker_id and sa.status in ('assigned', 'confirmed')) as still_on,
           exists (select 1 from client_order_notices n where n.confirmation_id = c.id and n.kind = 'removed') as removed_told
      from client_order_confirmations c
      join shifts s on s.id = c.shift_id
      join client_orders o on o.id = c.order_id
     where o.confirm_to_client and o.requested_by_email is not null and s.ends_at > now()
  ),
  due as (
    -- Cancelled: once per shift, against the latest person the client was told about.
    (select distinct on (shift_id) tenant_id, id as confirmation_id, 'cancelled'::text as kind, starts_at
       from conf
      where status = 'cancelled'
        and not exists (select 1 from client_order_notices n where n.shift_id = conf.shift_id and n.kind = 'cancelled')
      order by shift_id, sent_at desc)
    union all
    -- Taken off (still a shift to fill): once per person told about.
    select tenant_id, id, 'removed', starts_at
      from conf
     where status <> 'cancelled' and not still_on and not removed_told and settled
    union all
    -- Date, times or area changed while the person is still on it.
    select tenant_id, id, 'changed', starts_at
      from conf
     where status <> 'cancelled' and still_on and not removed_told and settled and told_known is not null
       and (select (t.starts_at, t.ends_at, t.area_id) is distinct from (conf.starts_at, conf.ends_at, conf.area_id)
              from app_client_told(conf.id) t)
  )
  select tenant_id, confirmation_id, kind from due order by starts_at limit greatest(1, least(p_limit, 500));
$$;
revoke execute on function app_client_notices_due(int, int) from public;
grant execute on function app_client_notices_due(int, int) to crop_app;
