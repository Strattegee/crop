-- Steve's ribbon (26 Oct): a shift shows purple when the person on it pulled out, so the office knows
-- it needs filling again rather than never having been filled. Recorded on the removed assignment.
alter table shift_assignments add column removed_reason text check (removed_reason in ('office', 'pulled_out'));
