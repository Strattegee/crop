-- Who sees and sends each kind of document in the app (David, 3 Nov 2026, answer 5: "who can input, change or see
-- each piece of information and each document"). Adds the document kinds to field_access: each credential category
-- (licence, registration, training, check, vaccination) and right to work, as `doc_<kind>`. Levels for documents are
-- hidden / see / approve (send it; the office checks it); the API refuses `change` for them (`DOC_RULES` in
-- apps/api/src/workforce/field-access.ts). No rows means CROP's default: they can send it (unchanged behaviour).
alter table field_access drop constraint field_access_field_check;
alter table field_access add constraint field_access_field_check check (field in (
  'name', 'preferred_name', 'email', 'mobile', 'addresses', 'gender',
  'doc_licence', 'doc_registration', 'doc_training', 'doc_check', 'doc_vaccination', 'doc_right_to_work'));
