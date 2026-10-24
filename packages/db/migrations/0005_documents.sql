-- Evidence files for worker credentials (spec CRD-3, CRD-4). The files live in object storage
-- (DigitalOcean Spaces, Sydney); this table holds what they are and who added them.

create table credential_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_credential_id uuid not null references worker_credentials(id),
  -- Object key in the bucket. Never contains names or other personal details.
  storage_key text not null unique,
  filename text not null check (length(filename) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references users(id)
);
create index credential_documents_cred_idx on credential_documents(tenant_id, worker_credential_id) where removed_at is null;

alter table credential_documents enable row level security;
create policy tenant_isolation on credential_documents
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Documents are marked removed, never deleted by the API, so the history stays complete.
revoke delete on credential_documents from crop_app;

-- New history entries for evidence.
alter table credential_events drop constraint credential_events_action_check;
alter table credential_events add constraint credential_events_action_check
  check (action in ('created', 'updated', 'verified', 'rejected', 'verification_reset', 'evidence_added', 'evidence_removed'));
