-- Requirement levels (David, 29 Oct): besides must have (hard) and should have (warning), a requirement can be
-- optional: listed for the business and for agencies, but never checked and never warned about.
alter type requirement_severity add value if not exists 'optional';

alter table shift_duty_requirements drop constraint if exists shift_duty_requirements_severity_check;
alter table shift_duty_requirements add constraint shift_duty_requirements_severity_check
  check (severity in ('hard', 'warning', 'optional'));
