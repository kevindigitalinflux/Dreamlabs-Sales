-- Lets a user remove decision-maker candidates they don't consider relevant.
--
-- Soft-dismiss rather than DELETE: find-decision-makers inserts with
-- ON CONFLICT DO NOTHING keyed on (lead_id, dedupe_key) (migration 039), so a hard
-- delete would just let the next search put the same person straight back. A
-- dismissed row keeps its key, the conflict still matches, and the person stays gone.
--
-- Until now this table had a SELECT policy only; every write goes through
-- service-role edge functions (search, reveal, the Apollo phone webhook), which
-- bypass RLS and grants, so they are unaffected. authenticated currently holds a
-- blanket UPDATE grant (Supabase default), so before adding an UPDATE policy,
-- narrow it to the single column a user may change: otherwise a lead editor could
-- rewrite a candidate's email or phone. Same REVOKE + column-scoped GRANT pattern
-- as profiles (017), organizations (025/037) and pipelines.

ALTER TABLE decision_maker_candidates ADD COLUMN dismissed_at TIMESTAMPTZ;

REVOKE UPDATE ON decision_maker_candidates FROM authenticated;
GRANT UPDATE (dismissed_at) ON decision_maker_candidates TO authenticated;

CREATE POLICY "decision_maker_candidates_dismiss" ON decision_maker_candidates
  FOR UPDATE
  USING (can_edit_lead(lead_id))
  WITH CHECK (can_edit_lead(lead_id));
