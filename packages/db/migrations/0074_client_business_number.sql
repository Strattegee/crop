-- Business number per country (backlog): clients.abn now holds the client's business number in the form of the
-- business's own country (AU ABN 11 digits, NZ NZBN 13 digits, US EIN 9 digits, UK Companies House number 8
-- characters). The API checks each country's form; the database only keeps the stored shape tidy. The column keeps
-- its name (renaming a column that holds data waits for David). Existing ABNs all still pass.
alter table clients drop constraint clients_abn_check;
alter table clients add constraint clients_abn_check check (abn is null or abn ~ '^[0-9A-Z]{8,13}$');
comment on column clients.abn is 'Business number in the business''s country''s form (ABN, NZBN, EIN or Companies House number); API field businessNumber';
