-- Documents kept on a person's record that aren't evidence for a credential or right to work (backlog item 11:
-- "a CV that is also kept as a document on the person's record"): a CV, a signed contract or another document the
-- office keeps. Office only: never in the app, never for supervisors, never for agency people.
--
-- Files live in the DocumentStore like credential evidence (keys without names). A CV sent with an online application
-- is recorded here too when the application makes a new applicant (same storage key, `job_application_file_id`).
-- Content is never edited: crop_app may only mark a document removed (the file is kept, like credential evidence).

create table worker_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  worker_id uuid not null references workers(id),
  kind text not null check (kind in ('cv', 'contract', 'other')),
  -- What it is, in the office's words ("Signed contract 2026", "Induction form"); required for `other`.
  title text check (title is null or length(title) between 1 and 120),
  storage_key text not null,
  filename text not null check (length(filename) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- office = uploaded on their page; application = sent with their online application.
  source text not null check (source in ('office', 'application')),
  job_application_file_id uuid unique references job_application_files(id),
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references users(id),
  check (kind <> 'other' or title is not null),
  check ((source = 'application') = (job_application_file_id is not null)),
  check ((removed_at is null) = (removed_by is null))
);
create index worker_documents_worker_idx on worker_documents(tenant_id, worker_id) where removed_at is null;

alter table worker_documents enable row level security;
create policy tenant_isolation on worker_documents using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Personal records, like addresses and credential files: never for supervisors (migration 0086's pattern).
create policy not_supervisor on worker_documents as restrictive using (not app_is_supervisor()) with check (not app_is_supervisor());
revoke update, delete on worker_documents from crop_app;
grant update (removed_at, removed_by) on worker_documents to crop_app;
create trigger worker_documents_audit after insert or update or delete on worker_documents for each row execute function app_audit();

-- CVs already sent with applications that made a new applicant are kept on the record too.
insert into worker_documents(tenant_id, worker_id, kind, storage_key, filename, content_type, size_bytes, sha256, source, job_application_file_id, uploaded_at)
select f.tenant_id, a.worker_id, 'cv', f.storage_key, f.filename, f.content_type, f.size_bytes, f.sha256, 'application', f.id, a.confirmed_at
  from job_application_files f
  join job_applications a on a.id = f.application_id
 where f.kind = 'cv' and a.status = 'confirmed' and a.outcome = 'new_applicant';
