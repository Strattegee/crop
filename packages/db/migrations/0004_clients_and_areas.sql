-- Clients, facility details and areas (spec ORG-2, ORG-3, ORG-4).

create type client_status as enum ('active', 'on_hold', 'inactive');

create table clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 200),
  abn text check (abn is null or abn ~ '^[0-9]{11}$'),
  status client_status not null default 'active',
  billing_contact_name text,
  billing_email text check (billing_email is null or billing_email = lower(billing_email)),
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index clients_name_uniq on clients(tenant_id, lower(name));

-- Facilities belong to a client. Existing facilities (from before clients existed) may have none yet.
alter table facilities
  add column client_id uuid references clients(id),
  add column address_line text,
  add column suburb text,
  add column state text check (state is null or state in ('VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT')),
  add column postcode text check (postcode is null or postcode ~ '^[0-9]{4}$'),
  add column phone text,
  add column parking_notes text,
  add column entry_notes text,
  add column active boolean not null default true;
create index facilities_client_idx on facilities(tenant_id, client_id);

-- Areas within a facility (a ward or unit), each with a specialty.
create table areas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null references facilities(id),
  name text not null check (length(trim(name)) between 1 and 120),
  specialty text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index areas_name_uniq on areas(facility_id, lower(name));

alter table clients enable row level security;
create policy tenant_isolation on clients using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table areas enable row level security;
create policy tenant_isolation on areas using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- A facility's client must belong to the same agency; RLS already hides other agencies' clients,
-- and this keeps the data consistent even for owner-level writes.
create function check_same_tenant() returns trigger language plpgsql as $$
begin
  if new.client_id is not null and not exists (select 1 from clients c where c.id = new.client_id and c.tenant_id = new.tenant_id) then
    raise exception 'client belongs to another agency';
  end if;
  return new;
end $$;
create trigger facilities_same_tenant before insert or update of client_id on facilities
  for each row execute function check_same_tenant();
