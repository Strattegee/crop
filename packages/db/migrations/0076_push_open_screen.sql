-- Tapping a push notification opens the right screen in the CROP app (backlog item 9). The sender needs each message's
-- template (which screen) and its business's slug (which business, for people in several), so the claim function
-- returns them too. Only the return columns change; what it claims and how is as before (0007).

drop function app_claim_notifications(int);

create function app_claim_notifications(p_limit int)
returns table (id uuid, tenant_id uuid, channel notification_channel, to_address text, subject text, body text, attempts int,
               template text, tenant_slug text)
language sql security definer set search_path = public, pg_temp as $$
  with claimed as (
    update notifications n set status = 'sending', attempts = n.attempts + 1, claimed_at = now()
     where n.id in (
       select q.id from notifications q
        where q.status = 'queued' and q.next_attempt_at <= now()
        order by q.next_attempt_at
        limit p_limit
        for update skip locked
     )
    returning n.id, n.tenant_id, n.channel, n.to_address, n.subject, n.body, n.attempts, n.template
  )
  select c.id, c.tenant_id, c.channel, c.to_address, c.subject, c.body, c.attempts, c.template, t.slug
    from claimed c join tenants t on t.id = c.tenant_id
$$;

revoke execute on function app_claim_notifications(int) from public;
grant execute on function app_claim_notifications(int) to crop_app;
