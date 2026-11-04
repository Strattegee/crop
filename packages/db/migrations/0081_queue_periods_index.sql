-- Allocations by calendar period (David, 4 Nov 2026): the queue looks up each shift's last person taken off (pulled
-- out or removed). Without an index that was a scan of every assignment per shift, which grows with history and
-- made a month (7,000+ shifts) slow. Only removed worker rows are indexed.
create index shift_assignments_removed_idx on shift_assignments(shift_id, ended_at desc)
  where resource_kind = 'worker' and status = 'removed';
