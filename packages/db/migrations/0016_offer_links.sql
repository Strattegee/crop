-- Offer links (backlog item 6, decided by David 26 Oct): a person may accept or decline a shift offer from a link
-- in the email or text, without signing in, until the worker app exists.
-- Each link is for one person and one offer. Only a SHA-256 hash of the random token is stored, so the table
-- (or a backup of it) can't be used to act on an offer. The link works only while the offer is pending
-- and not expired; that is checked when it is used.

alter table shift_offers add column link_hash bytea unique;
-- Who answered: the office recording the reply, or the person from their link.
alter table shift_offers add column responded_via text check (responded_via in ('office', 'link'));

-- The one thing the API can't do inside a tenant: find which business a link belongs to.
-- Returns only the business and the offer id for an exact hash; everything else is read through withTenant (RLS).
create function app_offer_by_link(p_hash bytea)
returns table (tenant_id uuid, offer_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.tenant_id, o.id from shift_offers o where p_hash is not null and o.link_hash = p_hash
$$;

revoke execute on function app_offer_by_link(bytea) from public;
grant execute on function app_offer_by_link(bytea) to crop_app;
