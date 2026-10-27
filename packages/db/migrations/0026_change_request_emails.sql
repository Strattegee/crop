-- Emails about change requests (backlog item 2): owners and admins hear when a request arrives, and the person who
-- asked hears when it is decided. crop_app can't read users, so the asker's sign-in email is copied onto the request
-- when it is made (requests made before this have none, so nobody is emailed about them).
alter table roster_change_requests add column requested_by_email text;
