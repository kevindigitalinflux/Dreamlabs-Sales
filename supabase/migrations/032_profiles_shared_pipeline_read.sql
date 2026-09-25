-- Lets a user read the profile of someone they've directly shared a pipeline
-- with, regardless of org. Without this, PipelineManage's outgoing-shares
-- list crashes (profiles!pipeline_shares_shared_with_user_id_fkey resolves
-- to NULL under RLS) for any cross-org share, since profiles_org_admin_read
-- only covers profiles within the caller's own org(s).
CREATE POLICY profiles_shared_pipeline_read ON profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM pipeline_shares ps
    WHERE ps.shared_with_user_id = profiles.id
      AND ps.shared_by = auth.uid()
  )
);
