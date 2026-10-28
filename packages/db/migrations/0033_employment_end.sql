-- End of employment (backlog: employment records). Employment ends on the last live terms' end date; these columns
-- say that the end is a leaving (not just the next terms starting), why, and who recorded it. Undoing an end is a
-- correction (migration 0032): the row is marked corrected and a copy without the end takes its place.
alter table employment_terms
  add column end_reason text check (end_reason in ('resigned', 'contract_ended', 'terminated', 'retired', 'other')),
  add column ended_by uuid,
  add column ended_at timestamptz,
  add constraint employment_terms_end_check check (end_reason is null or ends_on is not null);
