-- Distance in ranking (David, 4 Nov: "Yes if they are far away; if the distance is within a range it doesn't come
-- into account"). People who live further than this from a shift's site (straight line between postcodes) are
-- ranked after the others in their group; 0 = distance never counts. Never a block.
alter table tenant_settings add column distance_free_km int not null default 25
  check (distance_free_km between 0 and 1000);
