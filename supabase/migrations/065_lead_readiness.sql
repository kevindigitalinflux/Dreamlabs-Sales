-- Additive only. Reserved migration 065 intentionally follows applied migration 068.
-- REVIEW REQUIRED: do not apply until Claude has reviewed and Kevin authorizes this migration.
BEGIN;
ALTER TABLE public.leads
  ADD COLUMN readiness text CHECK (readiness IN ('ready', 'almost', 'needs_work')),
  ADD COLUMN readiness_missing text[];
COMMENT ON COLUMN public.leads.readiness IS 'Last completed Deep find assessment; NULL means not checked.';
COMMENT ON COLUMN public.leads.readiness_missing IS 'Missing facts: decision_maker, verified_email, confirmed_website, company_match.';
-- No grants, policies or guard triggers change. Existing table-wide UPDATE privileges include new columns.
-- The application writes these columns only through the run-deep-find service-role path.
COMMIT;
