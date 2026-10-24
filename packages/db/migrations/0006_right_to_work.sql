-- Right to work as its own record (spec CRD-6), replacing the generic "Right to work" credential.
-- What's recorded depends on the worker's status. A new record replaces the previous one; history is kept.

create type rtw_status as enum ('citizen', 'nz_citizen', 'permanent_resident', 'visa_holder');

create table right_to_work_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  status rtw_status not null,
  -- Citizens: which document proves it.
  citizen_proof_type text check (citizen_proof_type in ('au_passport', 'birth_certificate', 'citizenship_certificate')),
  document_number text,
  -- Visa holders.
  visa_type text,
  visa_subclass text check (visa_subclass is null or visa_subclass ~ '^[0-9]{3}$'),
  visa_grant_number text,
  visa_expiry date,
  work_limit text check (work_limit in ('unlimited', 'limited')),
  work_hours_per_fortnight int check (work_hours_per_fortnight between 1 and 336),
  -- Everyone except Australian citizens: VEVO check.
  vevo_checked_on date,
  vevo_result text check (vevo_result in ('confirmed', 'not_confirmed')),
  notes text,
  verification verification_status not null default 'unverified',
  verified_by uuid references users(id),
  verified_at timestamptz,
  verification_note text,
  rejection_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  check ((verification = 'rejected') = (rejection_reason is not null)),
  check (status <> 'citizen' or citizen_proof_type is not null),
  check (status = 'citizen' or (vevo_checked_on is not null and vevo_result is not null)),
  check (status <> 'visa_holder' or (visa_subclass is not null and visa_expiry is not null and work_limit is not null)),
  check ((work_limit = 'limited') = (work_hours_per_fortnight is not null))
);
create unique index right_to_work_current_uniq on right_to_work_records(worker_id) where superseded_at is null;
create index right_to_work_tenant_idx on right_to_work_records(tenant_id, worker_id);

create table right_to_work_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  record_id uuid not null references right_to_work_records(id),
  at timestamptz not null default now(),
  actor_user_id uuid references users(id),
  action text not null check (action in ('recorded', 'verified', 'rejected', 'evidence_added', 'evidence_removed', 'replaced')),
  details jsonb not null default '{}'
);

-- Documents can now belong to a credential or a right-to-work record.
alter table credential_documents alter column worker_credential_id drop not null;
alter table credential_documents add column right_to_work_id uuid references right_to_work_records(id);
alter table credential_documents add constraint credential_documents_one_parent
  check ((worker_credential_id is null) <> (right_to_work_id is null));
create index credential_documents_rtw_idx on credential_documents(tenant_id, right_to_work_id) where removed_at is null;

alter table right_to_work_records enable row level security;
create policy tenant_isolation on right_to_work_records using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
alter table right_to_work_events enable row level security;
create policy tenant_isolation on right_to_work_events using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on right_to_work_events from crop_app;
revoke delete on right_to_work_records from crop_app;

-- Right to work is now built in, so retire the generic credential type and its rules.
delete from credential_requirements r using credential_types t
  where r.credential_type_id = t.id and t.category = 'right_to_work';
update credential_types set active = false where category = 'right_to_work';
