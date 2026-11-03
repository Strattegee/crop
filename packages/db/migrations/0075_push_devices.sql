-- Push notifications to the CROP app (backlog items 9 and 9a). The app registers its Expo push token after sign-in;
-- messages for someone with the app are queued once per phone as channel 'push' (to_address = the token) and sent by
-- the same background sender as email and SMS. Sending stays off until PUSH_SEND=on (David switches it on once the
-- Expo project has Android (FCM) and Apple (APNs) credentials).
--
-- A phone's token is device state, not a business record, so there is no audit trigger (the token would otherwise
-- be copied into the audit log). Tokens are never shown to anyone. Sign-out and "device no longer registered" mark
-- the row removed; a phone re-registering brings it back.

alter type notification_channel add value if not exists 'push';

create table push_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  token text not null check (length(token) between 10 and 300),
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_reason text check (removed_reason in ('signed_out', 'not_registered', 'another_user'))
);
create unique index push_devices_live_uniq on push_devices(tenant_id, token) where removed_at is null;
create index push_devices_user_idx on push_devices(tenant_id, user_id) where removed_at is null;
alter table push_devices enable row level security;
create policy tenant_isolation on push_devices using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on push_devices from crop_app;

-- The sender works across businesses: when Expo says a token is no longer registered (app removed, notifications
-- switched off for good), it forgets that phone for the message's business.
create function app_push_device_gone(p_notification uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update push_devices d set removed_at = now(), removed_reason = 'not_registered'
    from notifications n
   where n.id = p_notification and n.channel::text = 'push'
     and d.tenant_id = n.tenant_id and d.token = n.to_address and d.removed_at is null
$$;
revoke execute on function app_push_device_gone(uuid) from public;
grant execute on function app_push_device_gone(uuid) to crop_app;
