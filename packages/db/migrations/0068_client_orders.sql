-- Client orders (David, 2 Nov 2026): a business that supplies staff to its clients (hospitals, aged care, …) takes
-- orders by email, phone or the client's portal and types them in. An order is who asked, how, their reference and
-- the shifts it made (one position each, at one of the client's sites). When a shift on an order is booked, the person
-- who asked is emailed the name of whoever is going and the shift (when the order says so and has an email).

create table client_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  facility_id uuid not null references facilities(id),
  channel text not null check (channel in ('email', 'phone', 'portal', 'other')),
  requested_by_name text not null check (length(trim(requested_by_name)) between 1 and 120),
  requested_by_email text check (requested_by_email is null or (requested_by_email = lower(requested_by_email) and length(requested_by_email) <= 200)),
  requested_by_phone text check (requested_by_phone is null or length(requested_by_phone) <= 40),
  client_reference text check (client_reference is null or length(client_reference) <= 60),
  notes text check (notes is null or length(notes) <= 1000),
  confirm_to_client boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index client_orders_recent_idx on client_orders(tenant_id, created_at desc);
create index client_orders_client_idx on client_orders(tenant_id, client_id);
alter table client_orders enable row level security;
create policy tenant_isolation on client_orders using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Orders are kept; their shifts are cancelled instead.
revoke delete on client_orders from crop_app;
create trigger client_orders_audit after insert or update or delete on client_orders for each row execute function app_audit();

-- The order a shift came from (null for shifts the business added itself).
alter table shifts add column client_order_id uuid references client_orders(id);
create index shifts_client_order_idx on shifts(client_order_id) where client_order_id is not null;

-- Each "booked" email sent to the client: one per shift and person. Its own history (append-only), so no audit trigger.
create table client_order_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  order_id uuid not null references client_orders(id),
  shift_id uuid not null references shifts(id),
  worker_id uuid not null references workers(id),
  notification_id uuid references notifications(id),
  sent_at timestamptz not null default now(),
  unique (shift_id, worker_id)
);
create index client_order_confirmations_order_idx on client_order_confirmations(order_id);
alter table client_order_confirmations enable row level security;
create policy tenant_isolation on client_order_confirmations using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on client_order_confirmations from crop_app;

-- The confirmations timer (no business selected): booked shifts on orders that want the client told, not yet
-- started, whose person hasn't been confirmed to the client yet. Ids only; the email is written in the business.
create function app_client_confirmations_due(p_limit int default 50)
returns table (tenant_id uuid, shift_id uuid, worker_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  select s.tenant_id, s.id, sa.worker_id
    from shifts s
    join client_orders o on o.id = s.client_order_id
    join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status = 'confirmed'
   where s.status = 'booked' and s.starts_at > now()
     and o.confirm_to_client and o.requested_by_email is not null
     and not exists (select 1 from client_order_confirmations c where c.shift_id = s.id and c.worker_id = sa.worker_id)
   order by s.starts_at
   limit greatest(1, least(p_limit, 500));
$$;
revoke execute on function app_client_confirmations_due(int) from public;
grant execute on function app_client_confirmations_due(int) to crop_app;
