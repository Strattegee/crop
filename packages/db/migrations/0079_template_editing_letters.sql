-- The Template tab (David, 3 Nov, answer 2): templates are edited as a week before a week is filled from them.
-- Template shifts stay append-only for content: changing one inserts a new row that `replaces_id` the old one and
-- marks the old one `removed_at`; removing one only sets `removed_at`. Every read of template shifts must add
-- `removed_at is null`. crop_app may update only `removed_at`.
alter table roster_template_shifts add column removed_at timestamptz;
alter table roster_template_shifts add column replaces_id uuid references roster_template_shifts(id);
grant update (removed_at) on roster_template_shifts to crop_app;
create index roster_template_shifts_live_idx on roster_template_shifts(template_id) where removed_at is null;

-- Letters on roster cards, per business (David, 3 Nov: each employer can customise them). Keys: duty, vehicle,
-- equipment, items, template, request; a missing key means CROP's default (D, V, E, I, T, R). Gender (F/M) and the
-- shift letters (A/P/N or the shift type's) aren't renamed here.
alter table tenant_settings add column marker_letters jsonb not null default '{}'::jsonb;
