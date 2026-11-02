-- Client contacts (2 Nov 2026, backlog: "client contacts saved per client"): the people at a client who order shifts
-- (a ward's nurse unit manager, a site supervisor). Saved once on the client, then picked when taking an order instead
-- of typing their name, email and phone each time. Switched off, never deleted (orders keep their own copy of the
-- details, so switching a contact off or editing it never rewrites an order).

create table client_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  name text not null check (length(trim(name)) between 1 and 120),
  position text check (position is null or length(position) <= 120),
  email text check (email is null or (email = lower(email) and length(email) <= 200)),
  phone text check (phone is null or length(phone) <= 40),
  notes text check (notes is null or length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_contacts_client_idx on client_contacts(tenant_id, client_id);
-- One live contact of a name per client (switched-off ones don't count, so a name can be reused).
create unique index client_contacts_live_name on client_contacts(client_id, lower(trim(name))) where active;
alter table client_contacts enable row level security;
create policy tenant_isolation on client_contacts using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on client_contacts from crop_app;
create trigger client_contacts_audit after insert or update or delete on client_contacts for each row execute function app_audit();

-- The saved contact an order came from (null when the details were typed in). The order's own requested_by_* columns
-- stay the record of who asked.
alter table client_orders add column contact_id uuid references client_contacts(id);
