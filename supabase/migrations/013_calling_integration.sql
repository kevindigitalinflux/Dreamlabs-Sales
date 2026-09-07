-- ─────────────────────────────────────────
-- CALLING INTEGRATION (PHASE 1: POWER DIALER) — schema only, provider-agnostic.
-- See docs/superpowers/specs/2026-09-07-calling-integration-design.md
-- ─────────────────────────────────────────

-- Per-contractor dialer connection. Mirrors user_email_settings exactly —
-- no org_id: calling is a personal resource, not a shared org one.
CREATE TABLE user_dialer_settings (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  provider      TEXT NOT NULL CHECK (provider IN ('justcall', 'kixie', 'aircall')),
  phone_number  TEXT,
  is_verified   BOOLEAN DEFAULT false,
  -- the real API key/secret is Vault-stored via app_set_dialer_secret/
  -- app_get_dialer_secret below — never a plain column.
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_dialer_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dialer_settings_own" ON user_dialer_settings
  USING (auth.uid() = user_id);

-- One row per completed call, regardless of provider. Org-scoped, matching
-- every other cycle-3+ table's established pattern.
CREATE TABLE calls (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           UUID REFERENCES leads(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES profiles(id),
  org_id            UUID REFERENCES organizations(id),
  provider          TEXT NOT NULL,
  external_call_id  TEXT NOT NULL,
  direction         TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  outcome           TEXT CHECK (outcome IN ('answered', 'voicemail', 'no_answer', 'busy', 'failed')),
  duration_seconds  INTEGER,
  recording_url     TEXT,
  transcript        TEXT,
  lead_note_id      UUID REFERENCES lead_notes(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, external_call_id)
);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calls_org_admin" ON calls FOR ALL USING (is_org_admin(org_id));
CREATE POLICY "calls_own_in_org" ON calls FOR ALL USING (
  is_org_member(org_id) AND (auth.uid() = user_id OR user_id IS NULL)
);

-- Vault helpers for per-user dialer API keys, mirroring app_set_smtp_secret
-- from 002_email_automation.sql exactly.
CREATE OR REPLACE FUNCTION app_set_dialer_secret(uid uuid, secret text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'dialer_key_' || uid::text;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(secret, 'dialer_key_' || uid::text);
  ELSE
    PERFORM vault.update_secret(existing_id, secret);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_get_dialer_secret(uid uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dialer_key_' || uid::text;
$$;

REVOKE ALL ON FUNCTION app_set_dialer_secret(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_get_dialer_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_set_dialer_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION app_get_dialer_secret(uuid) TO service_role;
