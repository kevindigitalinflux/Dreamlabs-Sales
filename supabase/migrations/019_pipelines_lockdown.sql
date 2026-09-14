-- Task 1 review follow-up: closes a live cross-org isolation bypass found during
-- Task 1's review -- pipelines_update had no protection against a pipeline owner
-- reassigning org_id (or is_default) after creation, proven live (rolled back) to let
-- a plain member move their own pipeline into an org they don't belong to and retain
-- full access to it and every lead inside it, bypassing the admin-to-admin
-- pipeline-shares edge function entirely. Also closes: no unique constraint stopped a
-- second is_default row per org; no WITH CHECK on pipelines_insert restricted
-- created_by (same spoofing gap already closed on leads_insert, left open here); the
-- 5 new SECURITY DEFINER functions omitted the search_path pinning is_org_admin/
-- is_org_member already set.

CREATE OR REPLACE FUNCTION pipelines_prevent_org_move() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.is_default IS DISTINCT FROM OLD.is_default THEN
    RAISE EXCEPTION 'org_id and is_default cannot be changed after a pipeline is created';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pipelines_immutable_org_and_default
  BEFORE UPDATE ON pipelines
  FOR EACH ROW
  EXECUTE FUNCTION pipelines_prevent_org_move();

CREATE UNIQUE INDEX pipelines_one_default_per_org ON pipelines(org_id) WHERE is_default;

DROP POLICY "pipelines_insert" ON pipelines;
CREATE POLICY "pipelines_insert" ON pipelines FOR INSERT WITH CHECK (
  is_org_member(org_id) AND is_default = false AND created_by = auth.uid()
);

ALTER FUNCTION can_view_pipeline(UUID) SET search_path = public;
ALTER FUNCTION can_edit_pipeline(UUID) SET search_path = public;
ALTER FUNCTION can_view_lead(UUID) SET search_path = public;
ALTER FUNCTION can_edit_lead(UUID) SET search_path = public;
ALTER FUNCTION can_insert_lead_into(UUID) SET search_path = public;
