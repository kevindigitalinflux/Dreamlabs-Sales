-- 060_deep_find_run_delete.sql
-- Lets people delete FINISHED Deep find runs from the new Jobs page (docs/superpowers/specs/2026-10-14-jobs-tracker-design.md).
--
-- SECURITY NOTES
-- * Before this migration deep_find_runs had NO delete right for browsers (only SELECT and UPDATE of status/cancel_reason).
-- * The new policy lets the run's creator or an organisation admin delete a run, and only when it is not 'active'
--   (stop a running run first). Another organisation's members and anon cannot delete anything.
-- * deep_find_leads rows go with the run through the existing ON DELETE CASCADE (a cascade runs as the table owner, so
--   no grant on deep_find_leads is needed). Leads, contacts already added and email logs are never touched.
-- * Scraper jobs and autopilot runs already have delete rights (scrape_jobs: FOR ALL policies; autopilot_runs: policy
--   autopilot_runs_delete in migration 049). Nothing about them changes.
GRANT DELETE ON public.deep_find_runs TO authenticated;

CREATE POLICY "deep_find_runs_delete" ON public.deep_find_runs FOR DELETE
  USING (is_org_member(org_id) AND status <> 'active' AND (created_by = auth.uid() OR is_org_admin(org_id)));
