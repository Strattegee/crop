-- Eligibility when assigning (backlog item 3): the business's minimum rest between shifts, in hours.
-- Less rest than this is a warning when rostering; 0 turns the check off.
alter table tenant_settings add column min_rest_hours int not null default 10 check (min_rest_hours between 0 and 24);
