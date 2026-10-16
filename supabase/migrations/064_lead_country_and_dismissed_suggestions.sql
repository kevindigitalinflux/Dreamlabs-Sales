-- Deep find review state belongs to the lead, across runs. Existing table-level
-- UPDATE grants and leads_update (023) cover these columns; RLS is unchanged.
BEGIN;
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS country text NULL,
  ADD COLUMN IF NOT EXISTS dismissed_suggestions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS registry_candidates_rejected boolean NOT NULL DEFAULT false;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_country_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_country_check CHECK (country IN ('GB', 'IE', 'US', 'OTHER'));

COMMENT ON COLUMN public.leads.country IS 'NULL preserves the existing UK-assumed lookup behaviour.';
COMMENT ON COLUMN public.leads.dismissed_suggestions IS 'Reviewed dismissals: email:<lowercase address> or person:<lowercase full name>.';
COMMENT ON COLUMN public.leads.registry_candidates_rejected IS 'User chose UK company not listed; cleared on country change or company selection.';
COMMIT;
