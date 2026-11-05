-- A stage's items (5 Nov): the consumables a project stage is expected to use, e.g. Demolition: 40 pairs of gloves,
-- 20 dust masks. What the stage has used comes from the stock ledger (`stock_movements` on the stage's shifts), so this
-- table only holds the plan. Content is never edited: changing a quantity marks the old row `removed_at` and adds a
-- new one; taking an item off marks it `removed_at`.

create table project_stage_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  stage_id uuid not null references project_stages(id),
  item_id uuid not null references items(id),
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 1000000),
  note text check (note is null or length(note) <= 200),
  added_by uuid references users(id),
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index project_stage_items_live on project_stage_items(stage_id, item_id) where removed_at is null;
create index project_stage_items_stage_idx on project_stage_items(tenant_id, stage_id) where removed_at is null;
alter table project_stage_items enable row level security;
create policy tenant_isolation on project_stage_items using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy site_scope on project_stage_items as restrictive
  using (app_site_scope() is null or exists (select 1 from project_stages s where s.id = stage_id))
  with check (app_site_scope() is null or exists (select 1 from project_stages s where s.id = stage_id));
revoke update, delete on project_stage_items from crop_app;
grant update (removed_at) on project_stage_items to crop_app;
create trigger project_stage_items_audit after insert or update or delete on project_stage_items for each row execute function app_audit();
