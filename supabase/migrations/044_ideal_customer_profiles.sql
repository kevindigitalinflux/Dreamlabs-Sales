-- Ideal customer profiles (ICPs): rich, per-org descriptions of who the org sells to
-- (e.g. "Property managers"): pain points, goals, objections, how to talk to them.
--
-- They feed email drafting two ways:
--   * {{pain_point}} falls back to the profile's top pain point when the lead has none of
--     its own noted, so a template reads as written for that kind of customer;
--   * the AI personalisation step is given the whole profile as context.
--
-- Which profile applies to an email: the lead's own (leads.icp_id) first, else the
-- template's (email_templates.icp_id), else the sequence's (email_sequences.icp_id).
-- ON DELETE SET NULL on all three, so deleting a profile just un-assigns it.
--
-- Access mirrors organizations.company_context: every org member can read profiles
-- (useful to know what the AI has been told), only org admins can create/edit/delete.
-- The edge functions read through the service role and re-check the profile belongs to
-- the lead's own org before using it.

CREATE TABLE ideal_customer_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  summary         TEXT,   -- who they are
  pain_points     TEXT,   -- one per line; the first is what {{pain_point}} falls back to
  goals           TEXT,   -- what they want / the outcomes they care about
  objections      TEXT,   -- what they push back on, and how to answer it
  messaging_notes TEXT,   -- tone, words to use or avoid, angles that land
  extra_context   TEXT,   -- anything else worth knowing
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ideal_customer_profiles_org_name ON ideal_customer_profiles (org_id, lower(name));

ALTER TABLE ideal_customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "icp_member_read" ON ideal_customer_profiles FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "icp_admin_insert" ON ideal_customer_profiles FOR INSERT WITH CHECK (is_org_admin(org_id));
CREATE POLICY "icp_admin_update" ON ideal_customer_profiles FOR UPDATE USING (is_org_admin(org_id)) WITH CHECK (is_org_admin(org_id));
CREATE POLICY "icp_admin_delete" ON ideal_customer_profiles FOR DELETE USING (is_org_admin(org_id));

CREATE TRIGGER ideal_customer_profiles_updated_at BEFORE UPDATE ON ideal_customer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_templates ADD COLUMN icp_id UUID REFERENCES ideal_customer_profiles(id) ON DELETE SET NULL;
ALTER TABLE email_sequences ADD COLUMN icp_id UUID REFERENCES ideal_customer_profiles(id) ON DELETE SET NULL;
ALTER TABLE leads           ADD COLUMN icp_id UUID REFERENCES ideal_customer_profiles(id) ON DELETE SET NULL;
