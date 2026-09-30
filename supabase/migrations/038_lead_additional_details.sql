-- Additional contact details per lead.
--
-- A lead has a single primary email/phone/website/owner_name. Fill missing
-- details often finds a DIFFERENT value than one the rep already has (often
-- straight from the owner), and overwriting that would lose good data. Those
-- found values are now kept alongside the primary one in these list columns;
-- the user can still choose to replace the primary instead.
--
-- leads carries a table-level UPDATE grant for authenticated (all columns), so
-- no grant change is needed; the existing row-level policies already govern who
-- can read/write a lead, and so who can touch these columns.

ALTER TABLE leads
  ADD COLUMN additional_emails   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN additional_phones   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN additional_websites TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN additional_owners   TEXT[] NOT NULL DEFAULT '{}';
