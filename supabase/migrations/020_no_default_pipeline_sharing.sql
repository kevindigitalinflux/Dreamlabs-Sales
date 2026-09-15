-- Sharing a Default Pipeline produced a pipeline visible in the recipient's switcher
-- with zero visible leads (can_view_pipeline honors an explicit share regardless of
-- is_default, but can_view_lead/can_edit_lead's default-pipeline carve-out has no
-- "AND shared" branch -- deliberately, to keep that carve-out narrow and easy to
-- reason about). Rather than widen the carve-out, block sharing a default pipeline
-- at the source: it was never a useful action, since it can't ever actually work.
DROP POLICY "pipeline_shares_insert" ON pipeline_shares;
CREATE POLICY "pipeline_shares_insert" ON pipeline_shares FOR INSERT WITH CHECK (
  can_edit_pipeline(pipeline_id)
  AND NOT (SELECT is_default FROM pipelines WHERE id = pipeline_id)
  AND EXISTS (
    SELECT 1 FROM pipelines p
    JOIN org_members om ON om.org_id = p.org_id
    WHERE p.id = pipeline_id AND om.user_id = shared_with_user_id
  )
);
