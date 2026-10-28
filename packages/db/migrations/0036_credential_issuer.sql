-- Who issued a credential (backlog: "Credential records: issuing organisation field"), e.g. "SafeWork NSW" or a
-- training provider. Optional free text; changing it on a checked credential sends it back for checking, like
-- the number and dates.
alter table worker_credentials add column issued_by text check (issued_by is null or length(issued_by) <= 120);
