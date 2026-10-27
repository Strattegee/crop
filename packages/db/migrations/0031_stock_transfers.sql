-- Moving stock from one site to another (backlog: items, transfers between sites).
-- A transfer is two ledger rows sharing a transfer_id: minus at the site it leaves, plus at the site it reaches,
-- both at the item's cost then. Rows stay append-only, like every other movement.
alter type stock_movement_kind add value if not exists 'transferred';

alter table stock_movements add column transfer_id uuid;

-- Compared as text: a new enum value can't be used in the transaction that adds it.
alter table stock_movements add constraint stock_movements_transfer_check check (
  case when kind::text = 'transferred'
    then transfer_id is not null and facility_id is not null and worker_id is null and shift_id is null
    else transfer_id is null
  end
);

create index stock_movements_transfer_idx on stock_movements(transfer_id) where transfer_id is not null;
