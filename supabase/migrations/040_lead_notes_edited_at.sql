-- Lets a lead's notes be edited after the fact, and marks the ones that were.
--
-- Editing needs no policy or grant change: notes_write (migration 018) already
-- allows ALL commands, UPDATE included, to anyone who can edit the lead, and
-- authenticated already holds UPDATE on the table. This only adds the marker, so
-- an edited note shows "(edited)" and its created_at still reflects when it
-- originally happened.

ALTER TABLE lead_notes ADD COLUMN edited_at TIMESTAMPTZ;
