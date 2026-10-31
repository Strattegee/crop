-- Onboarding checklists chosen by role (backlog item 11). A checklist can say which roles it is for; starting
-- onboarding without choosing one picks the checklist that fits the person's roles (checklistForRoles in
-- apps/api/src/workforce/onboarding.ts). Empty = for anyone. Roles are matched exactly, like credential rules.
alter table onboarding_checklists add column for_roles text[] not null default '{}';
