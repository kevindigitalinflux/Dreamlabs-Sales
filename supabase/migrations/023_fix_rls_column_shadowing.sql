-- Fixes a real bug in migration 022's own fix, caught by re-checking the actual
-- stored policy expressions (pg_policies.qual) after applying it, rather than trusting
-- the rolled-back test transactions alone.
--
-- 022 inlined can_view_pipeline/can_edit_pipeline/can_view_lead/can_edit_lead's logic
-- directly into pipelines_view and leads_view/leads_update/leads_delete to fix a
-- same-statement RETURNING visibility bug (see 022's own comment). But two of those
-- inlined expressions left column references unqualified inside an EXISTS subquery
-- whose inner table happens to share a column name with the outer table -- so Postgres
-- silently bound the reference to the INNER (subquery) table instead of the outer row
-- being evaluated:
--
-- 1. pipelines_view's `EXISTS (SELECT 1 FROM pipeline_shares WHERE pipeline_id = id ...)`
--    -- pipeline_shares has its OWN `id` column, so `id` resolved to
--    `pipeline_shares.id` instead of the outer `pipelines.id`. The clause became
--    `pipeline_shares.pipeline_id = pipeline_shares.id` -- a self-referential
--    comparison of two different-purpose UUID columns on the same row, effectively
--    always false. This silently broke ALL pipeline sharing: a pipeline shared with a
--    user (within-org or cross-org) became invisible to the recipient via
--    pipelines_view, even though pipeline_shares itself still had the grant row.
--
-- 2. leads_view/leads_update/leads_delete's `EXISTS (SELECT 1 FROM pipelines p WHERE
--    p.id = pipeline_id AND (... created_by IS NULL OR created_by = auth.uid() ...))`
--    -- pipelines ALSO has a `created_by` column, so the unqualified `created_by`
--    resolved to `p.created_by` (the PIPELINE's creator) instead of the outer
--    `leads.created_by` (the LEAD's creator). Since the Default Pipeline's own
--    `created_by` is NULL (system-created), `p.created_by IS NULL` was always true for
--    every lead inside it -- collapsing the per-lead created_by/assigned_to visibility
--    gate into "any org member can see every lead in the Default Pipeline," silently
--    widening access beyond the intended, carefully-designed carve-out (preserving
--    today's exact per-lead visibility) that this whole RLS model exists to protect.
--
-- Both re-verified live (rolled back, no lasting change) before this migration: a
-- non-admin contractor correctly stopped seeing another member's private lead in the
-- Default Pipeline, and correctly regained visibility into a pipeline explicitly
-- shared with them. RETURNING on pipeline/lead inserts (022's original fix target)
-- re-confirmed still working with these corrected, fully-qualified expressions.
--
-- Fix: give the subquery table an explicit alias and qualify every ambiguous column
-- reference by its real table name/alias, so nothing can shadow the outer row.

DROP POLICY "pipelines_view" ON pipelines;
CREATE POLICY "pipelines_view" ON pipelines FOR SELECT USING (
  is_org_admin(org_id)
  OR created_by = auth.uid()
  OR (is_default AND is_org_member(org_id))
  OR EXISTS (SELECT 1 FROM pipeline_shares ps WHERE ps.pipeline_id = pipelines.id AND ps.shared_with_user_id = auth.uid())
);

DROP POLICY "leads_view" ON leads;
CREATE POLICY "leads_view" ON leads FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM pipelines p WHERE p.id = leads.pipeline_id AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (leads.created_by IS NULL OR leads.created_by = auth.uid() OR leads.assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_view_pipeline(p.id))
    )
  )
);

DROP POLICY "leads_update" ON leads;
CREATE POLICY "leads_update" ON leads FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM pipelines p WHERE p.id = leads.pipeline_id AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (leads.created_by IS NULL OR leads.created_by = auth.uid() OR leads.assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_edit_pipeline(p.id))
    )
  )
);

DROP POLICY "leads_delete" ON leads;
CREATE POLICY "leads_delete" ON leads FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM pipelines p WHERE p.id = leads.pipeline_id AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (leads.created_by IS NULL OR leads.created_by = auth.uid() OR leads.assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_edit_pipeline(p.id))
    )
  )
);
