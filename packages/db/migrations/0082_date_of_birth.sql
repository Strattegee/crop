-- Workers under 18 (David, 3 Nov, answer 8): there is no age limit on the app, but a person's record can hold their
-- date of birth (office only: never shown in the app, never sent in messages, never shared with another business) so
-- CROP can mark under-18s and warn when they are put on work the business has set as 18 and over, or on late-night
-- work. Never a block: the minimum working age and the rules differ by state and kind of work, so the office decides.
alter table workers add column date_of_birth date check (date_of_birth >= date '1900-01-01');

-- Roles and duties the business sets as "18 and over only" (e.g. Bar attendant; Serves alcohol).
alter table business_roles add column adults_only boolean not null default false;
alter table shift_duties add column adults_only boolean not null default false;
