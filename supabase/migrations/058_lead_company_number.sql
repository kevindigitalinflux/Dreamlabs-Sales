-- 058: Deep find v2. The lead's registered company number (Companies House), chosen automatically on a clear match
-- or by the user with "Use this company".
--
-- SECURITY NOTE (additive only; no RLS policy or grant change on any table):
-- * leads.company_number: nullable TEXT with a format CHECK (8 digits, or 2 letters + 6 digits). The existing leads
--   policies (migrations 018/023) cover it like every other leads column. authenticated already has table-level
--   UPDATE on leads, so a member who can edit a lead could also set this column through REST, like `website`; the
--   app writes it only from edge functions (run-deep-find choose_company after an org + can_edit_lead check and a
--   live Companies House lookup, or the engine on a clear match), and every reader re-validates the format
--   (cleanCompanyNumber) before using it in a Companies House URL.
-- Additive and idempotent: safe to apply before the code that reads it is deployed.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_number TEXT;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_company_number_format;
ALTER TABLE leads ADD CONSTRAINT leads_company_number_format
  CHECK (company_number IS NULL OR company_number ~ '^([0-9]{8}|[A-Z]{2}[0-9]{6})$');
