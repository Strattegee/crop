-- Outgoing email and SMS (spec NOT-1, NOT-4). Messages are queued in this table and sent by a
-- background loop in the API (the Postgres-backed job queue), with retries and a delivery log.

create type notification_channel as enum ('email', 'sms');
create type notification_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  channel notification_channel not null,
  to_address text not null,
  -- Which kind of message (e.g. 'test', 'credential_expiry'), for the log and for de-duplicating reminders.
  template text not null,
  -- Prevents the same reminder being sent twice (e.g. 'expiry:<credential>:30').
  dedupe_key text,
  subject text,
  body text not null,
  worker_id uuid references workers(id),
  status notification_status not null default 'queued',
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  provider_message_id text,
  last_error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index notifications_dedupe_uniq on notifications(tenant_id, dedupe_key) where dedupe_key is not null;
create index notifications_queue_idx on notifications(next_attempt_at) where status = 'queued';
create index notifications_log_idx on notifications(tenant_id, created_at desc);

alter table notifications enable row level security;
create policy tenant_isolation on notifications using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on notifications from crop_app;

-- Monthly SMS cap per agency (NOT-4), in number of messages.
alter table tenant_settings add column sms_monthly_cap int not null default 2000 check (sms_monthly_cap between 0 and 1000000);

-- The sender works across agencies, so it claims and completes messages through these functions
-- (owner rights) rather than seeing every agency's rows directly.
create function app_claim_notifications(p_limit int)
returns table (id uuid, tenant_id uuid, channel notification_channel, to_address text, subject text, body text, attempts int)
language sql security definer set search_path = public, pg_temp as $$
  update notifications n set status = 'sending', attempts = n.attempts + 1, claimed_at = now()
   where n.id in (
     select q.id from notifications q
      where q.status = 'queued' and q.next_attempt_at <= now()
      order by q.next_attempt_at
      limit p_limit
      for update skip locked
   )
  returning n.id, n.tenant_id, n.channel, n.to_address, n.subject, n.body, n.attempts
$$;

create function app_finish_notification(p_id uuid, p_ok boolean, p_provider_id text, p_error text, p_retry_in_seconds int)
returns void language sql security definer set search_path = public, pg_temp as $$
  update notifications set
    status = case when p_ok then 'sent'::notification_status
                  when p_retry_in_seconds is null then 'failed'::notification_status
                  else 'queued'::notification_status end,
    sent_at = case when p_ok then now() else sent_at end,
    provider_message_id = coalesce(p_provider_id, provider_message_id),
    last_error = case when p_ok then null else left(p_error, 500) end,
    next_attempt_at = case when p_retry_in_seconds is null then next_attempt_at else now() + make_interval(secs => p_retry_in_seconds) end
  where id = p_id and status = 'sending'
$$;

-- Messages left in 'sending' by a crash are put back in the queue.
create function app_requeue_stuck_notifications() returns int
language sql security definer set search_path = public, pg_temp as $$
  with r as (
    update notifications set status = 'queued', next_attempt_at = now()
     where status = 'sending' and claimed_at < now() - interval '10 minutes'
    returning 1
  ) select count(*)::int from r
$$;

revoke execute on function app_claim_notifications(int) from public;
revoke execute on function app_finish_notification(uuid, boolean, text, text, int) from public;
revoke execute on function app_requeue_stuck_notifications() from public;
grant execute on function app_claim_notifications(int) to crop_app;
grant execute on function app_finish_notification(uuid, boolean, text, text, int) to crop_app;
grant execute on function app_requeue_stuck_notifications() to crop_app;
