-- Taking the order from a new customer's request in one step (answer 4, continued; migration 0089). The order made
-- from an accepted request remembers it, so the request shows its order and can't make a second one by mistake.
-- "request_page" is how such an order arrived (alongside email, phone, portal and other).
alter table client_orders add column customer_request_id uuid unique references customer_requests(id);
alter table client_orders drop constraint client_orders_channel_check;
alter table client_orders add constraint client_orders_channel_check check (channel in ('email', 'phone', 'portal', 'other', 'request_page'));
