-- User-defined email placeholders, e.g. {{google_meet_link}}, usable in templates, sequence
-- steps and AI drafts alongside the built-ins ({{first_name}}, {{business_name}}, ...).
--
-- Two scopes in one table:
--   user_id NULL      company-wide value, managed by org admins (e.g. {{company_phone}})
--   user_id = a user  that user's own value (e.g. their {{google_meet_link}}); it overrides a
--                     company-wide value with the same key when that user is the sender
--
-- Emails are written by one person, so the placeholder is filled from the SENDER's values:
-- the signed-in user for a manual draft, the enrolling user for a sequence step.
--
-- Access: a member reads company-wide values plus their OWN personal ones (never another
-- user's); a member writes only their own; only org admins write company-wide values. The
-- email edge functions read through the service role (they need the sender's values, which
-- RLS would hide from any other caller) and only ever load company-wide + that sender's.

CREATE TABLE custom_variables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  key        TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label      TEXT,
  value      TEXT NOT NULL CHECK (length(value) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX custom_variables_org_key ON custom_variables (org_id, key) WHERE user_id IS NULL;
CREATE UNIQUE INDEX custom_variables_user_key ON custom_variables (org_id, user_id, key) WHERE user_id IS NOT NULL;

ALTER TABLE custom_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_variables_read" ON custom_variables FOR SELECT
  USING (is_org_member(org_id) AND (user_id IS NULL OR user_id = auth.uid()));

CREATE POLICY "custom_variables_insert" ON custom_variables FOR INSERT
  WITH CHECK ((user_id = auth.uid() AND is_org_member(org_id)) OR (user_id IS NULL AND is_org_admin(org_id)));

CREATE POLICY "custom_variables_update" ON custom_variables FOR UPDATE
  USING ((user_id = auth.uid() AND is_org_member(org_id)) OR (user_id IS NULL AND is_org_admin(org_id)))
  WITH CHECK ((user_id = auth.uid() AND is_org_member(org_id)) OR (user_id IS NULL AND is_org_admin(org_id)));

CREATE POLICY "custom_variables_delete" ON custom_variables FOR DELETE
  USING ((user_id = auth.uid() AND is_org_member(org_id)) OR (user_id IS NULL AND is_org_admin(org_id)));

CREATE TRIGGER custom_variables_updated_at BEFORE UPDATE ON custom_variables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
