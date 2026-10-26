-- Steve (26 Oct): each business sets its own shift types: a letter, a name and standard hours
-- (D / Day shift / 7:00–3:30; nurses use AM / PM / NS). The letter shows on roster cards; when a shift
-- has no type or its type has no letter, the roster falls back to A / P / N from the start time.
alter table shift_codes add column letter text check (letter ~ '^[A-Z0-9]{1,3}$');
