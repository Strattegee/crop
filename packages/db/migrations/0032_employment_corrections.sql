-- Correcting a mistaken employment entry (backlog: employment records).
-- Nothing is overwritten or deleted: a mistaken row is marked withdrawn (who, when, why) and, for a correction,
-- a new row takes its place with replaces_id pointing back at it. Every reader ignores withdrawn rows.
alter table employment_terms
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid,
  add column withdrawn_reason text check (withdrawn_reason in ('corrected', 'withdrawn')),
  add column replaces_id uuid references employment_terms(id),
  add constraint employment_terms_withdrawn_check check ((withdrawn_at is null) = (withdrawn_reason is null));

create index employment_terms_live_idx on employment_terms(worker_id, starts_on desc) where withdrawn_at is null;

-- History stays: the API never deletes employment terms.
revoke delete on employment_terms from crop_app;
