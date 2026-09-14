-- Multi-pipeline support: named, ownable, shareable groupings of leads. See
-- docs/superpowers/specs/2026-09-14-multi-pipeline-design.md for the full design.

CREATE TABLE pipelines (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pipeline_shares (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id         UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES profiles(id),
  permission          TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
  shared_by           UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pipeline_id, shared_with_user_id)
);

ALTER TABLE leads ADD COLUMN pipeline_id UUID REFERENCES pipelines(id);
ALTER TABLE leads ADD COLUMN forked_from_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

-- One "Default Pipeline" per existing org, every existing lead backfilled into it.
DO $$
DECLARE
  org_row RECORD;
  new_pipeline_id UUID;
BEGIN
  FOR org_row IN SELECT id FROM organizations LOOP
    INSERT INTO pipelines (org_id, name, is_default, created_by)
    VALUES (org_row.id, 'Default Pipeline', true, NULL)
    RETURNING id INTO new_pipeline_id;

    UPDATE leads SET pipeline_id = new_pipeline_id
    WHERE org_id = org_row.id AND pipeline_id IS NULL;
  END LOOP;
END $$;

ALTER TABLE leads ALTER COLUMN pipeline_id SET NOT NULL;

-- Pipeline-level rights: rename/delete/share metadata. A plain default-pipeline
-- member never gets these — only the creator or an org admin manages a pipeline's
-- own metadata, even the shared default one.
CREATE OR REPLACE FUNCTION can_view_pipeline(target_pipeline UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = target_pipeline AND (
      is_org_admin(p.org_id)
      OR p.created_by = auth.uid()
      OR (p.is_default AND is_org_member(p.org_id))
      OR EXISTS (SELECT 1 FROM pipeline_shares WHERE pipeline_id = target_pipeline AND shared_with_user_id = auth.uid())
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION can_edit_pipeline(target_pipeline UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = target_pipeline AND (
      is_org_admin(p.org_id) OR p.created_by = auth.uid()
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Lead-level rights: read/write one lead row. Inside a default pipeline this
-- reproduces today's exact created_by/assigned_to rule for every org member; inside
-- a named pipeline it's pure pipeline membership (owner, admin, or an explicit share).
CREATE OR REPLACE FUNCTION can_view_lead(target_lead UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM leads l JOIN pipelines p ON p.id = l.pipeline_id
    WHERE l.id = target_lead AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (l.created_by IS NULL OR l.created_by = auth.uid() OR l.assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_view_pipeline(p.id))
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION can_edit_lead(target_lead UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM leads l JOIN pipelines p ON p.id = l.pipeline_id
    WHERE l.id = target_lead AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id) AND (l.created_by IS NULL OR l.created_by = auth.uid() OR l.assigned_to = auth.uid()))
      OR (NOT p.is_default AND can_edit_pipeline(p.id))
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- INSERT has no existing row to check yet, so it's checked against the target
-- pipeline directly: a new lead in a default pipeline is createable by any org
-- member (today's behavior); in a named pipeline, only by someone who can edit it.
CREATE OR REPLACE FUNCTION can_insert_lead_into(target_pipeline UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = target_pipeline AND (
      is_org_admin(p.org_id)
      OR (p.is_default AND is_org_member(p.org_id))
      OR (NOT p.is_default AND can_edit_pipeline(p.id))
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pipelines_view" ON pipelines FOR SELECT USING (can_view_pipeline(id));
CREATE POLICY "pipelines_insert" ON pipelines FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "pipelines_update" ON pipelines FOR UPDATE USING (can_edit_pipeline(id));
CREATE POLICY "pipelines_delete" ON pipelines FOR DELETE USING (can_edit_pipeline(id) AND NOT is_default);

ALTER TABLE pipeline_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pipeline_shares_view" ON pipeline_shares FOR SELECT USING (
  shared_with_user_id = auth.uid() OR can_edit_pipeline(pipeline_id)
);
-- Only within-org shares can be inserted directly by a client. Cross-org shares are
-- only ever created by the pipeline-shares edge function (Task 11), using the
-- service role, after its own admin-to-admin authorization check.
CREATE POLICY "pipeline_shares_insert" ON pipeline_shares FOR INSERT WITH CHECK (
  can_edit_pipeline(pipeline_id)
  AND EXISTS (
    SELECT 1 FROM pipelines p
    JOIN org_members om ON om.org_id = p.org_id
    WHERE p.id = pipeline_id AND om.user_id = shared_with_user_id
  )
);
CREATE POLICY "pipeline_shares_delete" ON pipeline_shares FOR DELETE USING (
  can_edit_pipeline(pipeline_id) OR shared_with_user_id = auth.uid()
);

DROP POLICY "leads_own_in_org" ON leads;
DROP POLICY "leads_org_admin" ON leads;
CREATE POLICY "leads_view" ON leads FOR SELECT USING (can_view_lead(id));
CREATE POLICY "leads_insert" ON leads FOR INSERT WITH CHECK (
  can_insert_lead_into(pipeline_id)
  AND (
    is_org_admin((SELECT org_id FROM pipelines WHERE id = pipeline_id))
    OR NOT (SELECT is_default FROM pipelines WHERE id = pipeline_id)
    OR created_by = auth.uid()
  )
);
CREATE POLICY "leads_update" ON leads FOR UPDATE USING (can_edit_lead(id));
CREATE POLICY "leads_delete" ON leads FOR DELETE USING (can_edit_lead(id));

DROP POLICY "notes_own_in_org" ON lead_notes;
DROP POLICY "notes_org_admin" ON lead_notes;
CREATE POLICY "notes_view" ON lead_notes FOR SELECT USING (can_view_lead(lead_id));
CREATE POLICY "notes_write" ON lead_notes FOR ALL USING (can_edit_lead(lead_id));
