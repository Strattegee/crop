-- Equipment-only shifts (backlog item 4): equipment booked for a time without a person from the business,
-- e.g. a machine dry-hired to a client who supplies the operator. Ordinary shifts need a person (and may also have
-- equipment, as in wet hire). On an equipment-only shift nobody can be assigned and status follows the equipment:
-- open with none booked, booked once something is.
alter table shifts add column needs_person boolean not null default true;
