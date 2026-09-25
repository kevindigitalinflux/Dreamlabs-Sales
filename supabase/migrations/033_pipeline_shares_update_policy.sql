-- pipeline_shares had INSERT/SELECT/DELETE policies but no UPDATE policy,
-- which silently blocks the ON CONFLICT DO UPDATE branch of an upsert (used
-- to make re-sharing with the same person idempotent instead of erroring on
-- the pipeline_id/shared_with_user_id unique constraint). Same gate as
-- insert/delete: whoever can edit the pipeline can update its shares.
CREATE POLICY pipeline_shares_update ON pipeline_shares
FOR UPDATE
USING (can_edit_pipeline(pipeline_id))
WITH CHECK (can_edit_pipeline(pipeline_id));
