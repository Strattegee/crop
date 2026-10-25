-- Items and consumables (backlog item 5): things the business issues to people or uses on shifts, such as PPE,
-- fuel and sundries. A catalogue of items with a unit cost (and an optional price charged to the client), stock
-- on hand per site, and an append-only ledger of every movement. On hand = the sum of a site's movements.

create table items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 80),
  category text not null default 'other' check (category in ('ppe', 'fuel', 'sundries', 'tools', 'other')),
  -- How it is counted: each, pair, box, litre…
  unit text not null default 'each' check (length(trim(unit)) between 1 and 20),
  sku text check (sku is null or length(sku) <= 40),
  -- Cost to the business per unit, in cents. Copied onto each movement, so past costs don't change.
  unit_cost_cents int not null default 0 check (unit_cost_cents between 0 and 100000000),
  -- Price per unit charged to the client, in cents; null when it isn't charged on.
  charge_cents int check (charge_cents is null or charge_cents between 0 and 100000000),
  -- Stock is counted per site; when false (e.g. fuel bought on a card) use is recorded without an on-hand check.
  tracks_stock boolean not null default true,
  -- On hand at or below this at a site shows as low.
  reorder_level numeric(12,3) check (reorder_level is null or reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index items_name_uniq on items(tenant_id, lower(name));
create unique index items_sku_uniq on items(tenant_id, lower(sku)) where sku is not null;

create type stock_movement_kind as enum ('received', 'issued', 'used', 'returned', 'adjusted');

-- Every change to stock. Positive quantities add to the site's stock, negative take from it.
-- issued: handed to a person (optionally for a shift); used: used on a shift; returned: back from a person or shift;
-- adjusted: a stocktake correction. Corrections are new rows; rows are never changed or deleted.
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  item_id uuid not null references items(id),
  facility_id uuid references facilities(id),
  kind stock_movement_kind not null,
  quantity numeric(12,3) not null check (quantity <> 0),
  worker_id uuid references workers(id),
  shift_id uuid references shifts(id),
  unit_cost_cents int not null,
  charge_cents int,
  notes text check (notes is null or length(notes) <= 500),
  recorded_by uuid,
  created_at timestamptz not null default now(),
  check (
    case kind
      when 'received' then quantity > 0 and facility_id is not null and worker_id is null and shift_id is null
      when 'issued' then quantity < 0 and worker_id is not null
      when 'used' then quantity < 0 and shift_id is not null and worker_id is null
      when 'returned' then quantity > 0 and (worker_id is not null or shift_id is not null)
      when 'adjusted' then facility_id is not null and worker_id is null and shift_id is null
    end
  )
);
create index stock_movements_item_site_idx on stock_movements(tenant_id, item_id, facility_id);
create index stock_movements_shift_idx on stock_movements(shift_id) where shift_id is not null;
create index stock_movements_worker_idx on stock_movements(worker_id) where worker_id is not null;

alter table items enable row level security;
create policy tenant_isolation on items using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table stock_movements enable row level security;
create policy tenant_isolation on stock_movements using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on stock_movements from crop_app;
