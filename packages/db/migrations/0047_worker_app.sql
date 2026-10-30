-- Worker app (backlog item 9): a person in a business's workforce signs in to the app and sees their own shifts
-- and offers.
--
-- Giving app access: an owner or admin invites the person's email as a worker membership, using the same
-- invitations as the platform tools (accepted only at a sign-in where the identity provider says the email is
-- verified). The invitation remembers which person (worker row) it is for; the first time the signed-in user asks
-- for their own things, the API links workers.user_id from the accepted invitation. One account per person in each
-- business.
alter table invitations add column worker_id uuid references workers(id);
create unique index workers_user_uniq on workers(tenant_id, user_id) where user_id is not null;

-- Replies made in the app by the person themselves.
alter table shift_changes drop constraint shift_changes_via_check;
alter table shift_changes add constraint shift_changes_via_check check (via in ('office', 'link', 'system', 'agency', 'app'));
alter table shift_offers drop constraint shift_offers_responded_via_check;
alter table shift_offers add constraint shift_offers_responded_via_check check (responded_via in ('office', 'link', 'app'));

-- After publishing (migrations 0024, 0042): a reply in the app is treated like a reply link: allowed unless the
-- business has locked published weeks.
create or replace function app_roster_change_refusal(p_facility uuid, p_week date) returns text language plpgsql stable as $$
declare
  rule text;
  via text := nullif(current_setting('app.actor_via', true), '');
  actor_role text := nullif(current_setting('app.actor_role', true), '');
begin
  if not exists (select 1 from roster_publications p where p.facility_id = p_facility and p.week_start = p_week) then
    return null;
  end if;
  select ts.published_changes into rule from tenant_settings ts join facilities f on f.tenant_id = ts.tenant_id where f.id = p_facility;
  rule := coalesce(rule, 'open');
  if rule = 'open' or via is null or via = 'system' then
    return null;
  end if;
  if via in ('link', 'app') then
    if rule = 'locked' then
      return 'This roster can''t be changed now. Please contact the office.';
    end if;
    return null;
  end if;
  if via = 'agency' then
    if rule = 'locked' then
      return 'The employer has locked this week''s roster, so nobody can be put on this shift now.';
    end if;
    return null;
  end if;
  if rule = 'locked' then
    return 'This week''s roster has been published and changes are turned off. An owner or admin can turn them back on in Settings.';
  end if;
  if actor_role in ('owner', 'admin') then
    return null;
  end if;
  return 'This week''s roster has been published, so only an owner or admin can change it.';
end $$;
