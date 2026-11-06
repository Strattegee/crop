-- Phone alerts for the office (backlog item 9a, David 29 Oct: "push notifications for what can't wait (someone pulls
-- out, a shift starting soon with nobody on it or unconfirmed, a request waiting), with quiet hours").
--
-- One row per office person and business with their own choices; no row = CROP's defaults (both kinds on, quiet
-- 22:00-06:00 in the business's time zone, `ALERT_DEFAULTS` in notifications/manager-alerts.ts). Quiet hours both set
-- or both empty (= no quiet hours). Alerts go to the phones the person registered in `push_devices`.
create table member_alerts (
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  decisions boolean not null default true,
  at_risk boolean not null default true,
  quiet_from time,
  quiet_until time,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  constraint member_alerts_quiet_both check ((quiet_from is null) = (quiet_until is null)),
  constraint member_alerts_quiet_span check (quiet_from is null or quiet_from <> quiet_until)
);
alter table member_alerts enable row level security;
create policy tenant_isolation on member_alerts using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke delete on member_alerts from crop_app;
create trigger member_alerts_audit after insert or update or delete on member_alerts for each row execute function app_audit();
