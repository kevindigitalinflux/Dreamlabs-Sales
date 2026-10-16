-- Deep find review state belongs to the lead, across runs. Existing table-level
-- UPDATE grants and leads_update (023) cover these columns; RLS is unchanged.
ALTER TABLE public.leads
  ADD COLUMN country text NULL CHECK (country IN ('GB', 'IE', 'US', 'OTHER')),
  ADD COLUMN dismissed_suggestions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN registry_candidates_rejected boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leads.country IS 'NULL preserves the existing UK-assumed lookup behaviour.';
COMMENT ON COLUMN public.leads.dismissed_suggestions IS 'Reviewed dismissals: email:<lowercase address> or person:<lowercase full name>.';
COMMENT ON COLUMN public.leads.registry_candidates_rejected IS 'User rejected Companies House candidates; do not ask again or auto-pick on reruns.';
