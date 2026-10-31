-- The agency's dashboard (David, 31 Oct: after the employer dashboards): a business that supplies employers through
-- CROP can give its office people the Agency dashboard.
alter table member_focus drop constraint member_focus_focus_check;
alter table member_focus add constraint member_focus_focus_check check (focus in ('allocator', 'compliance', 'recruitment', 'overview', 'agency'));
