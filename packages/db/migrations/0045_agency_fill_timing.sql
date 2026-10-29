-- Agency fill timing set by each employer (backlog item 8; David 26 Oct: "timing by urgency, client-set, with
-- defaults"). How long each agency has a request before the next one in the business's order gets it too, in three
-- bands worked out from the shift's start: within 2 hours, later the same day (the site's date), the next day or later.
-- The defaults are David's: 10 minutes, 1 hour, 2 hours.

alter table tenant_settings
  add column agency_step_soon_minutes int not null default 10 check (agency_step_soon_minutes between 1 and 240),
  add column agency_step_today_minutes int not null default 60 check (agency_step_today_minutes between 1 and 720),
  add column agency_step_later_minutes int not null default 120 check (agency_step_later_minutes between 1 and 1440);

-- The gap used for a request (the business's setting for its band, or the office's choice when sending it).
-- Null for requests sent before this migration.
alter table agency_requests add column step_minutes int check (step_minutes between 1 and 1440);
grant insert (step_minutes) on agency_requests to crop_app;
