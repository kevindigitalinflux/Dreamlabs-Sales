-- Existing sequences remain active. Imports explicitly write false and never enrol a lead.
-- Additive and transaction-safe; no existing RLS, grant, sequence steps or enrolment changes.
BEGIN;
ALTER TABLE public.email_sequences ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
COMMIT;
