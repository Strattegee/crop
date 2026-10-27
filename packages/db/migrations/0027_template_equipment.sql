-- Equipment in roster templates and copied weeks (backlog item 2). A template shift remembers the equipment usually
-- booked on it; applying the template (or copying a week) books it again wherever the usual checks allow (active,
-- dates current on the day, not double booked, operator rule), and otherwise leaves it off with the reason.
create table roster_template_equipment (
  tenant_id uuid not null references tenants(id),
  template_shift_id uuid not null references roster_template_shifts(id),
  equipment_id uuid not null references equipment(id),
  primary key (template_shift_id, equipment_id)
);
create index roster_template_equipment_equipment_idx on roster_template_equipment(equipment_id);
alter table roster_template_equipment enable row level security;
create policy tenant_isolation on roster_template_equipment using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
revoke update, delete on roster_template_equipment from crop_app;
