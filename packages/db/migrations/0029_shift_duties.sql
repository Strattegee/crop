-- Shift duties (conditional requirements, from the café demo review 26 Oct). A business lists duties such as
-- "Serves alcohol" or "Food safety supervisor"; each duty names the credentials it needs (hard or warning). A shift
-- carries any number of duties, and whoever works it must also meet its duties' rules, so a waiter whose RSA has
-- expired can still work a shift that doesn't serve alcohol.
create table shift_duties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index shift_duties_name_idx on shift_duties(tenant_id, lower(name));
alter table shift_duties enable row level security;
create policy tenant_isolation on shift_duties using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
-- Duties are switched off, never deleted (shifts and their history point at them).
revoke delete on shift_duties from crop_app;

-- What a duty needs. Replaced as a set when the office edits the duty (configuration, not history).
create table shift_duty_requirements (
  tenant_id uuid not null references tenants(id),
  duty_id uuid not null references shift_duties(id),
  credential_type_id uuid not null references credential_types(id),
  severity text not null default 'hard' check (severity in ('hard', 'warning')),
  primary key (duty_id, credential_type_id)
);
create index shift_duty_requirements_type_idx on shift_duty_requirements(credential_type_id);
alter table shift_duty_requirements enable row level security;
create policy tenant_isolation on shift_duty_requirements using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());

-- The duties on a shift. Adding or removing one is a shift change: logged, and subject to the after-publishing rule.
create table shift_duty_links (
  tenant_id uuid not null references tenants(id),
  shift_id uuid not null references shifts(id),
  duty_id uuid not null references shift_duties(id),
  created_at timestamptz not null default now(),
  primary key (shift_id, duty_id)
);
create index shift_duty_links_duty_idx on shift_duty_links(duty_id);
alter table shift_duty_links enable row level security;
create policy tenant_isolation on shift_duty_links using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update on shift_duty_links from crop_app;

alter table shift_changes drop constraint shift_changes_kind_check;
alter table shift_changes add constraint shift_changes_kind_check check (kind in ('created', 'assigned', 'booked', 'confirmed', 'unassigned',
  'pulled_out', 'cancelled', 'equipment_added', 'equipment_removed', 'times_changed', 'notes_changed', 'duty_added', 'duty_removed'));

create function app_shift_duty_links_changed() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform app_log_shift_change(new.shift_id, 'duty_added', null, null, (select name from shift_duties where id = new.duty_id));
  else
    perform app_log_shift_change(old.shift_id, 'duty_removed', null, null, (select name from shift_duties where id = old.duty_id));
  end if;
  return null;
end $$;
create trigger shift_duty_links_changed after insert or delete on shift_duty_links for each row execute function app_shift_duty_links_changed();

-- Templates remember each shift's duties; applying a template or copying a week adds them back (before the usual person).
create table roster_template_duties (
  tenant_id uuid not null references tenants(id),
  template_shift_id uuid not null references roster_template_shifts(id),
  duty_id uuid not null references shift_duties(id),
  primary key (template_shift_id, duty_id)
);
create index roster_template_duties_duty_idx on roster_template_duties(duty_id);
alter table roster_template_duties enable row level security;
create policy tenant_isolation on roster_template_duties using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on roster_template_duties from crop_app;
