-- A person's addresses (David, 3 Nov 2026, answer 5: "never overwrite"; previous home addresses must be kept, and a
-- person can hold several addresses and nominate which is current, moving between them). Office only for now: the
-- app's "My details" comes with the field-access settings (who can see and change each field).
--
-- Content is never edited: correcting a typo inserts a new row that `replaces_id` the old one and marks the old one
-- `replaced_at`; taking one off the list marks it `removed_at` (with an optional reason). Both stay on file as the
-- address's history. crop_app may update only the current flag and those markers.
create table worker_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  -- Optional name for it: "Home", "Parents'", "Postal".
  label text check (label is null or length(label) between 1 and 40),
  line1 text not null check (length(line1) between 1 and 200),
  line2 text check (line2 is null or length(line2) between 1 and 200),
  suburb text check (suburb is null or length(suburb) between 1 and 100),
  region text check (region is null or length(region) between 1 and 60),
  postcode text check (postcode is null or length(postcode) between 1 and 10),
  country text not null check (country in ('AU', 'NZ', 'US', 'GB')),
  is_current boolean not null default false,
  replaces_id uuid references worker_addresses(id),
  replaced_at timestamptz,
  removed_at timestamptz,
  removed_reason text check (removed_reason is null or length(removed_reason) between 1 and 200),
  created_at timestamptz not null default now(),
  check (not is_current or (replaced_at is null and removed_at is null))
);
create index worker_addresses_worker_idx on worker_addresses(tenant_id, worker_id);
-- At most one current address per person.
create unique index worker_addresses_one_current on worker_addresses(worker_id) where is_current;
-- A row is replaced at most once.
create unique index worker_addresses_replaces_once on worker_addresses(replaces_id) where replaces_id is not null;
alter table worker_addresses enable row level security;
create policy tenant_isolation on worker_addresses using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on worker_addresses from crop_app;
grant update (is_current, replaced_at, removed_at, removed_reason) on worker_addresses to crop_app;
create trigger worker_addresses_audit after insert or update or delete on worker_addresses for each row execute function app_audit();
