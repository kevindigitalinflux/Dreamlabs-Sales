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
