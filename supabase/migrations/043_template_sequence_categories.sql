-- Free-text category on email templates and sequences (e.g. "Property managers"), so
-- they can be grouped, filtered and told apart when choosing one. Optional; NULL means
-- uncategorised. Purely organisational: nothing server-side reads it.
--
-- No policy or grant change: both tables already let their owners (and org admins)
-- update their own rows, and the client's save payloads simply gain this column.

ALTER TABLE email_templates ADD COLUMN category TEXT;
ALTER TABLE email_sequences ADD COLUMN category TEXT;
