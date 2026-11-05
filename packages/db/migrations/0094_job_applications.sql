-- Applying online (David approved 5 Nov 2026; backlog item 11, spam decisions 29 Oct). Each business can switch on a
-- public application form (/apply/<slug>) with CROP's starter questions (each off, optional or required) and its own.
-- What someone sends waits as `pending` until they confirm their email through a one-off link (48 hours); only then
-- do they become an applicant on the recruitment board (Applied) and the office is told.
--
-- What the applicant sent is never edited: crop_app may update only the status and confirmation columns. Expired
-- unconfirmed applications (and their file rows) may be deleted, nothing else. The audit trigger records updates only
-- (confirmation): the row is its own record of what was sent, and an unconfirmed one that is cleared away leaves no
-- copy of someone's details behind.

-- The business's form: open or closed (closed by default), a welcome line, and its questions (only the business's
-- choices: CROP's defaults are filled in by `formOf` in apps/api/src/workforce/apply-form.ts).
create table apply_forms (
  tenant_id uuid primary key references tenants(id),
  is_open boolean not null default false,
  intro text check (intro is null or length(intro) <= 800),
  questions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);
alter table apply_forms enable row level security;
create policy tenant_isolation on apply_forms using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on apply_forms from crop_app;
create trigger apply_forms_audit after insert or update or delete on apply_forms for each row execute function app_audit();

-- A random key per business that signs the form's "opened at" stamp (too-fast submissions are refused) and hashes
-- applicants' IP addresses for the hourly limit (never stored as typed). Working state, not a record: no audit.
create table apply_form_keys (
  tenant_id uuid primary key references tenants(id),
  key bytea not null default gen_random_bytes(32),
  created_at timestamptz not null default now()
);
alter table apply_form_keys enable row level security;
create policy tenant_isolation on apply_form_keys using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on apply_form_keys from crop_app;

create table job_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  first_name text not null check (length(first_name) between 1 and 100),
  last_name text not null check (length(last_name) between 1 and 100),
  email text not null check (email = lower(email) and length(email) <= 254),
  -- E.164, read in the business's country.
  mobile text check (mobile is null or mobile ~ '^\+\d{8,15}$'),
  suburb text check (suburb is null or length(suburb) <= 100),
  region text check (region is null or length(region) <= 60),
  postcode text check (postcode is null or length(postcode) <= 10),
  country text not null check (country in ('AU', 'NZ', 'US', 'GB')),
  roles text[] not null default '{}',
  -- full_time / part_time / casual
  work_types text[] not null default '{}' check (work_types <@ array['full_time', 'part_time', 'casual']::text[]),
  -- [{weekday 1–7, periods am/pm/night}], null when not asked or not answered.
  availability jsonb,
  -- Their own say only: yes/no and a status, never numbers or visa details. The office records and checks it later.
  right_to_work text check (right_to_work in ('yes', 'no')),
  right_to_work_status text check (right_to_work_status in ('citizen', 'nz_citizen', 'permanent_resident', 'visa_holder')),
  drivers_licence boolean,
  own_car boolean,
  -- Credential types they say they hold (the business's own ids).
  credential_type_ids uuid[] not null default '{}',
  about text check (about is null or length(about) <= 2000),
  heard_from text check (heard_from is null or length(heard_from) <= 60),
  heard_other text check (heard_other is null or length(heard_other) <= 200),
  -- The business's own questions as asked: [{id, label, type, value}] (labels copied, so later edits change nothing).
  custom_answers jsonb not null default '[]'::jsonb,
  -- Agreeing to the privacy policy and worker privacy notice: which version, when.
  consent_version text not null check (length(consent_version) between 1 and 80),
  consented_at timestamptz not null,
  -- HMAC of the IP address with the business's form key (for the hourly limit); the address itself is never kept.
  ip_hash bytea,
  link_hash bytea not null unique,
  link_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  worker_id uuid references workers(id),
  -- new_applicant = a person was added at Applied; existing_person = the email was already someone's, so it was added to their record.
  outcome text check (outcome in ('new_applicant', 'existing_person')),
  check ((status = 'confirmed') = (confirmed_at is not null)),
  check ((status = 'confirmed') = (worker_id is not null and outcome is not null))
);
create index job_applications_tenant_idx on job_applications(tenant_id, created_at desc);
create index job_applications_worker_idx on job_applications(tenant_id, worker_id) where worker_id is not null;
create index job_applications_email_idx on job_applications(tenant_id, email, created_at);
create index job_applications_ip_idx on job_applications(tenant_id, ip_hash, created_at) where ip_hash is not null;
alter table job_applications enable row level security;
create policy tenant_isolation on job_applications using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Personal records, like addresses: never for supervisors (migration 0086's pattern).
create policy not_supervisor on job_applications as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
-- Only unconfirmed applications whose link has run out may be cleared away.
create policy purge_expired on job_applications as restrictive for delete using (status = 'pending' and link_expires_at < now());
revoke update, delete on job_applications from crop_app;
grant update (status, confirmed_at, worker_id, outcome) on job_applications to crop_app;
grant delete on job_applications to crop_app;
create trigger job_applications_audit after update on job_applications for each row execute function app_audit();

-- Files sent with an application (CV, a credential's proof, a file question). Stored like credential evidence
-- (DocumentStore, keys without names); on confirmation a credential's file is also recorded in credential_documents
-- under the same key. Append-only, its own history: no audit trigger.
create table job_application_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  application_id uuid not null references job_applications(id),
  kind text not null check (kind in ('cv', 'credential', 'question')),
  credential_type_id uuid references credential_types(id),
  question_id text check (question_id is null or length(question_id) <= 40),
  storage_key text not null unique,
  filename text not null check (length(filename) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((kind = 'credential') = (credential_type_id is not null)),
  check ((kind = 'question') = (question_id is not null))
);
create index job_application_files_app_idx on job_application_files(tenant_id, application_id);
alter table job_application_files enable row level security;
create policy tenant_isolation on job_application_files using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy not_supervisor on job_application_files as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
create policy purge_expired on job_application_files as restrictive for delete
  using (exists (select 1 from job_applications a where a.id = application_id and a.status = 'pending' and a.link_expires_at < now()));
revoke update, delete on job_application_files from crop_app;
grant delete on job_application_files to crop_app;

-- The one thing the API can't do inside a business: find which business a confirmation link belongs to. Exact hash
-- only; whether the link still works is checked by the caller inside withTenant.
create function app_job_application_by_link(p_hash bytea)
returns table (tenant_id uuid, application_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.tenant_id, a.id from job_applications a where p_hash is not null and a.link_hash = p_hash
$$;
revoke execute on function app_job_application_by_link(bytea) from public;
grant execute on function app_job_application_by_link(bytea) to crop_app;
