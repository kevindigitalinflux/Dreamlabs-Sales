-- ─────────────────────────────────────────
-- CYCLE 3 PART A: organizations, membership, org API keys (additive — no
-- existing table, column, or policy is touched here)
-- ─────────────────────────────────────────

CREATE TABLE organizations (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                    TEXT NOT NULL,
  use_global_api_fallback BOOLEAN DEFAULT false,
  created_by              UUID REFERENCES profiles(id),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
-- organizations_member_read policy is created further down, AFTER
-- org_members exists — Postgres requires a referenced table to exist
-- before a policy naming it can be created.

CREATE TABLE org_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'contractor' CHECK (role IN ('admin','contractor')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_self_read" ON org_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "org_members_admin_read" ON org_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM org_members me WHERE me.org_id = org_members.org_id AND me.user_id = auth.uid() AND me.role = 'admin')
);
-- No client write policy: membership changes (invite/role-change) go through
-- the admin-users edge function (service role) only — see Task 4.

CREATE POLICY "organizations_member_read" ON organizations FOR SELECT USING (
  EXISTS (SELECT 1 FROM org_members WHERE org_id = organizations.id AND user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION is_org_admin(target_org UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id = target_org AND user_id = auth.uid() AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION is_org_member(target_org UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id = target_org AND user_id = auth.uid())
$$;

CREATE TABLE org_api_settings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('gemini','google_places','companies_house')),
  is_configured BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, provider)
);
ALTER TABLE org_api_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_api_settings_member_read" ON org_api_settings FOR SELECT USING (is_org_member(org_id));
-- No client write policy: writes go through a dedicated edge function
-- (service role) — same pattern as user_email_settings/SMTP in cycle 2.

CREATE OR REPLACE FUNCTION app_set_org_api_key(target_org UUID, target_provider TEXT, secret TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing_id uuid; secret_name text := 'org_api_key_' || target_org::text || '_' || target_provider;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = secret_name;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(secret, secret_name);
  ELSE
    PERFORM vault.update_secret(existing_id, secret);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_get_org_api_key(target_org UUID, target_provider TEXT)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'org_api_key_' || target_org::text || '_' || target_provider;
$$;

REVOKE ALL ON FUNCTION app_set_org_api_key(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_get_org_api_key(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_set_org_api_key(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION app_get_org_api_key(uuid, text) TO service_role;

INSERT INTO organizations (name, use_global_api_fallback) VALUES
  ('Digital Influx Dreamlabs', true),
  ('Mr Brush & Co', true),
  ('Digital Influx', false),
  ('UX Tree', false);

-- ─────────────────────────────────────────
-- CYCLE 3 PART B: additive org_id columns + backfill + platform_role.
-- Nullable/new-column-only — old code, old RLS policies, old profiles.role
-- and is_admin() are completely unaffected by this section.
-- ─────────────────────────────────────────

ALTER TABLE leads ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE scrape_jobs ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE email_logs ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE email_templates ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE email_sequences ADD COLUMN org_id UUID REFERENCES organizations(id);
-- email_templates/email_sequences.org_id stays nullable forever:
-- NULL = platform default (today's 5 templates / 2 sequences), unchanged.

ALTER TABLE profiles ADD COLUMN platform_role TEXT DEFAULT 'user' CHECK (platform_role IN ('platform_admin','user'));

DO $$
DECLARE di_org_id UUID;
BEGIN
  SELECT id INTO di_org_id FROM organizations WHERE name = 'Digital Influx Dreamlabs';

  UPDATE leads SET org_id = di_org_id WHERE org_id IS NULL;
  UPDATE scrape_jobs SET org_id = di_org_id WHERE org_id IS NULL;
  UPDATE email_logs SET org_id = di_org_id WHERE org_id IS NULL;
  UPDATE email_templates SET org_id = di_org_id WHERE org_id IS NULL AND is_default = false;
  UPDATE email_sequences SET org_id = di_org_id WHERE org_id IS NULL AND is_default = false;

  INSERT INTO org_members (org_id, user_id, role)
  SELECT di_org_id, id, role FROM profiles
  ON CONFLICT (org_id, user_id) DO NOTHING;

  UPDATE profiles SET platform_role = 'platform_admin' WHERE email = 'kevindigitalinflux@gmail.com';
END $$;

-- ─────────────────────────────────────────
-- HOTFIX (found + applied live during Task 3 verification): the original
-- Task 1 policies below caused infinite RLS recursion (Postgres error
-- 42P17) on every authenticated select against org_members or
-- organizations — org_members_admin_read had a raw self-referential
-- subquery on org_members written inside a policy ON org_members, and
-- organizations_member_read transitively triggered the same recursion via
-- its own subquery against org_members. Fix: route both through the
-- SECURITY DEFINER is_org_admin()/is_org_member() helpers, which bypass
-- RLS internally and are exactly what they exist for — this is the
-- documented Postgres/Supabase pattern for avoiding self-referential RLS
-- recursion. Applied to the live DB and verified (org_members/organizations
-- reads now succeed as expected) before this fix was committed here.
-- ─────────────────────────────────────────

DROP POLICY "org_members_admin_read" ON org_members;
CREATE POLICY "org_members_admin_read" ON org_members FOR SELECT USING (
  is_org_admin(org_id)
);

DROP POLICY "organizations_member_read" ON organizations;
CREATE POLICY "organizations_member_read" ON organizations FOR SELECT USING (
  is_org_member(id)
);

-- ─────────────────────────────────────────
-- CYCLE 3 PART C (Task 8): leads + lead_notes RLS cutover
-- ─────────────────────────────────────────

ALTER TABLE leads ALTER COLUMN org_id SET NOT NULL;

DROP POLICY "leads_own" ON leads;
DROP POLICY "leads_admin" ON leads;
CREATE POLICY "leads_org_admin" ON leads FOR ALL USING (is_org_admin(org_id));
CREATE POLICY "leads_own_in_org" ON leads FOR ALL USING (
  is_org_member(org_id) AND (auth.uid() = created_by OR auth.uid() = assigned_to)
);

DROP POLICY "notes_lead_access" ON lead_notes;
DROP POLICY "notes_admin" ON lead_notes;
CREATE POLICY "notes_org_admin" ON lead_notes FOR ALL USING (
  EXISTS (SELECT 1 FROM leads WHERE id = lead_notes.lead_id AND is_org_admin(leads.org_id))
);
CREATE POLICY "notes_own_in_org" ON lead_notes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM leads
    WHERE id = lead_notes.lead_id AND is_org_member(leads.org_id)
    AND (leads.created_by = auth.uid() OR leads.assigned_to = auth.uid())
  )
);
