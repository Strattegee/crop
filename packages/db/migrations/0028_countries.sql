-- CROP goes international (David and Steve, 27 Oct): Australia first, then New Zealand, the USA and the UK.
-- Each business has a country and a time zone; each site has its own country and time zone
-- (shift times were always stored in UTC plus the site's time zone, so nothing else changes).
-- Australian sites keep the state list and 4-digit postcodes; other countries take their own region and postcode.

alter table tenant_settings add column country text not null default 'AU' check (country in ('AU', 'NZ', 'US', 'GB'));

alter table facilities add column country text not null default 'AU' check (country in ('AU', 'NZ', 'US', 'GB'));
alter table facilities drop constraint if exists facilities_state_check;
alter table facilities drop constraint if exists facilities_postcode_check;
alter table facilities add constraint facilities_region_check check (
  state is null
  or (country = 'AU' and state in ('VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'))
  or (country = 'US' and state ~ '^[A-Z]{2}$')
  or (country in ('NZ', 'GB') and length(trim(state)) between 1 and 60));
alter table facilities add constraint facilities_postcode_check check (
  postcode is null
  or (country in ('AU', 'NZ') and postcode ~ '^[0-9]{4}$')
  or (country = 'US' and postcode ~ '^[0-9]{5}(-[0-9]{4})?$')
  or (country = 'GB' and postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'));
