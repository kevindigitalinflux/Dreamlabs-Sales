-- Fixes a real, previously-undetected production bug: pipelines_view/pipelines_update/
-- pipelines_delete and leads_view/leads_update/leads_delete used can_view_pipeline(id)/
-- can_edit_pipeline(id)/can_view_lead(id)/can_edit_lead(id), and each of those functions
-- does `SELECT 1 FROM pipelines p WHERE p.id = target_pipeline ...` (or the equivalent
-- self-join on `leads`) -- a lookup against the SAME table the policy is attached to.
--
-- That self-referential lookup cannot see a row inserted earlier in the SAME statement
-- (command-counter hasn't incremented mid-statement), so any `INSERT ... RETURNING`
-- against `pipelines` or `leads` -- which PostgREST/supabase-js always uses when a
-- `.select()` is chained onto `.insert()` -- fails with "new row violates row-level
-- security policy", even though the exact same boolean check evaluates true a moment
-- later as an ordinary SELECT. Reproduced and root-caused live (rolled back, no lasting
-- change) via a direct SET LOCAL ROLE authenticated + SET LOCAL request.jwt.claims
-- simulation before writing this fix. Confirmed broken: creating any new pipeline
-- (Pipeline Manage's "Create empty"/CSV/scrape, and forkPipeline), and Dream Agent's
-- `create`/`confirmed_ambiguous_as_new` actions in useDreamAgentSession's confirmAll
-- (both insert into `leads` with `.select('id').single()`).
--
-- Fix: inline each function's boolean logic directly into the pipelines/leads policies
-- that were checking a row of THEIR OWN table, using unqualified column references
-- (which resolve to the row currently being evaluated, not a re-scanned copy) instead
-- of a self-referential subquery. The can_view_pipeline/can_edit_pipeline/can_view_lead/
-- can_edit_lead functions themselves are left untouched -- they're still correct and
-- still needed for pipeline_shares/lead_notes' policies and the nested pipeline-level
-- checks inside the lead functions, where the row being evaluated is a DIFFERENT,
-- already-committed table (so the same-statement visibility problem doesn't apply).

DROP POLICY "pipelines_view" ON pipelines;
CREATE POLICY "pipelines_view" ON pipelines FOR SELECT USING (
  is_org_admin(org_id)
  OR created_by = auth.uid()
  OR (is_default AND is_org_member(org_id))
  OR EXISTS (SELECT 1 FROM pipeline_shares WHERE pipeline_id = id AND shared_with_user_id = auth.uid())
);

DROP POLICY "pipelines_update" ON pipelines;
CREATE POLICY "pipelines_update" ON pipelines FOR UPDATE USING (
  is_org_admin(org_id) OR created_by = auth.uid()
);

DROP POLICY "pipelines_delete" ON pipelines;
CREATE POLICY "pipelines_delete" ON pipelines FOR DELETE USING (
  (is_org_admin(org_id) OR created_by = auth.uid()) AND NOT is_default
);

DROP POLICY "leads_view" ON leads;
CREATE POLICY "leads_view" ON leads FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM pipelines p WHERE p.id = pipeline_id AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (created_by IS NULL OR created_by = auth.uid() OR assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_view_pipeline(p.id))
    )
  )
);

DROP POLICY "leads_update" ON leads;
CREATE POLICY "leads_update" ON leads FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM pipelines p WHERE p.id = pipeline_id AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (created_by IS NULL OR created_by = auth.uid() OR assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_edit_pipeline(p.id))
    )
  )
);

DROP POLICY "leads_delete" ON leads;
CREATE POLICY "leads_delete" ON leads FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM pipelines p WHERE p.id = pipeline_id AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (created_by IS NULL OR created_by = auth.uid() OR assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_edit_pipeline(p.id))
    )
  )
);
