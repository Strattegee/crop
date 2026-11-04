-- New customers asking for staff online (David, 3 Nov 2026, answer 4: "CROP needs a way for a customer to register
-- online, as a once-off or repeat customer"). Each business can switch on a public "request staff" page
-- (/request/<slug>); what a customer sends waits here for the office, which accepts it (making them a client, or
-- linking a client it already has) or declines it. Nothing is booked until the office takes the order.
-- What the customer sent is never edited: crop_app may update only the decision columns. Audited.
alter table tenant_settings add column customer_requests_open boolean not null default false;
-- A short welcome line the business may show at the top of its page.
alter table tenant_settings add column customer_requests_intro text check (customer_requests_intro is null or length(customer_requests_intro) <= 500);

create table customer_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  business_name text not null check (length(business_name) between 1 and 200),
  contact_name text not null check (length(contact_name) between 1 and 200),
  email text not null check (length(email) <= 254),
  phone text check (phone is null or length(phone) <= 30),
  -- once = a one-off need; repeat = they expect to order again.
  frequency text not null check (frequency in ('once', 'repeat')),
  site_name text check (site_name is null or length(site_name) <= 200),
  address text not null check (length(address) between 1 and 300),
  suburb text check (suburb is null or length(suburb) <= 100),
  region text check (region is null or length(region) <= 100),
  postcode text check (postcode is null or length(postcode) <= 12),
  role text not null check (length(role) between 1 and 100),
  work_date date not null,
  start_time time not null,
  end_time time not null,
  people smallint not null check (people between 1 and 20),
  notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'new' check (status in ('new', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  decided_by_name text,
  decided_note text check (decided_note is null or length(decided_note) <= 300),
  client_id uuid references clients(id),
  check ((status = 'new') = (decided_at is null)),
  check ((status = 'accepted') = (client_id is not null))
);
create index customer_requests_tenant_idx on customer_requests(tenant_id, created_at desc);
create index customer_requests_new_idx on customer_requests(tenant_id, created_at) where status = 'new';
alter table customer_requests enable row level security;
create policy tenant_isolation on customer_requests using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Office work, not a site's: never for supervisors (migration 0086's pattern).
create policy not_supervisor on customer_requests as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
revoke update, delete on customer_requests from crop_app;
grant update (status, decided_at, decided_by, decided_by_name, decided_note, client_id) on customer_requests to crop_app;
create trigger customer_requests_audit after insert or update or delete on customer_requests for each row execute function app_audit();
