-- Dreamlabs Sales — initial schema (SPEC.md §3 + design-doc amendments)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- PROFILES (extends auth.users)
-- ─────────────────────────────────────────
CREATE TABLE profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email         TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'contractor'
                  CHECK (role IN ('admin', 'contractor')),
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Amendment 1: SECURITY DEFINER helper — avoids infinite recursion when a
-- profiles policy needs to read profiles. Used by every admin policy below.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_read"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_admin_read"  ON profiles FOR SELECT USING (is_admin());
CREATE POLICY "profiles_self_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Amendment 3: clients may only update safe columns — never role.
-- (Table-level UPDATE is revoked, then column-level UPDATE granted back.)
REVOKE UPDATE ON profiles FROM authenticated, anon;
GRANT UPDATE (full_name, avatar_url, updated_at) ON profiles TO authenticated;

-- Amendment 2: auto-create a profile row on first sign-in / invite.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─────────────────────────────────────────
-- USER EMAIL SETTINGS (SMTP, stored server-side)
-- ─────────────────────────────────────────
CREATE TABLE user_email_settings (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  provider       TEXT DEFAULT 'gmail' CHECK (provider IN ('gmail','outlook','yahoo','smtp')),
  smtp_host      TEXT,
  smtp_port      INTEGER DEFAULT 587,
  smtp_user      TEXT,
  -- smtp_pass stored encrypted via Supabase Vault, never in this column
  from_name      TEXT,
  is_verified    BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_settings_own" ON user_email_settings
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- SCRAPE JOBS
-- ─────────────────────────────────────────
CREATE TABLE scrape_jobs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by      UUID REFERENCES profiles(id),
  icp_raw_input   TEXT,
  icp_params      JSONB,
  sources         TEXT[] DEFAULT ARRAY['google_places'],
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
  results_count   INTEGER DEFAULT 0,
  approved_count  INTEGER DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scrape_jobs_own"   ON scrape_jobs FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "scrape_jobs_admin" ON scrape_jobs FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- RAW LEADS (pre-approval holding area)
-- ─────────────────────────────────────────
CREATE TABLE raw_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scrape_job_id   UUID REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  business_name   TEXT NOT NULL,
  owner_name      TEXT,
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  address         TEXT,
  city            TEXT,
  postcode        TEXT,
  google_rating   DECIMAL(2,1),
  review_count    INTEGER,
  vertical        TEXT,
  source          TEXT,
  source_id       TEXT,
  raw_data        JSONB,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','duplicate')),
  duplicate_of    UUID REFERENCES raw_leads(id),
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE raw_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raw_leads_own" ON raw_leads FOR ALL USING (
  EXISTS (SELECT 1 FROM scrape_jobs WHERE id = raw_leads.scrape_job_id AND created_by = auth.uid())
);
CREATE POLICY "raw_leads_admin" ON raw_leads FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- PIPELINE LEADS
-- ─────────────────────────────────────────
CREATE TABLE leads (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name     TEXT NOT NULL,
  owner_name        TEXT,
  phone             TEXT,
  email             TEXT,
  website           TEXT,
  address           TEXT,
  city              TEXT,
  postcode          TEXT,
  google_rating     DECIMAL(2,1),
  review_count      INTEGER,
  vertical          TEXT,
  stage             TEXT DEFAULT 'new_lead'
                      CHECK (stage IN (
                        'new_lead','contacted','audit_booked','proposal_sent',
                        'negotiating','won','lost','not_now_nurture'
                      )),
  package_tier      TEXT CHECK (package_tier IN (
                      'pilot_systems','pilot_ai_app','pilot_full_build',
                      'automation_sprint','ai_foundation','full_build',
                      'retainer_bronze','retainer_silver','retainer_gold','custom'
                    )),
  deal_value        DECIMAL(10,2),
  assigned_to       UUID REFERENCES profiles(id),
  created_by        UUID REFERENCES profiles(id),
  raw_lead_id       UUID REFERENCES raw_leads(id),
  next_action_date  DATE,
  next_action_note  TEXT,
  call_count        INTEGER DEFAULT 0,
  last_contacted_at TIMESTAMPTZ,
  kanban_position   INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_own" ON leads FOR ALL USING (
  auth.uid() = created_by OR auth.uid() = assigned_to
);
CREATE POLICY "leads_admin" ON leads FOR ALL USING (is_admin());

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- LEAD NOTES
-- ─────────────────────────────────────────
CREATE TABLE lead_notes (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id            UUID REFERENCES leads(id) ON DELETE CASCADE,
  created_by         UUID REFERENCES profiles(id),
  content            TEXT NOT NULL,
  note_type          TEXT DEFAULT 'general'
                       CHECK (note_type IN ('call','email','meeting','general','ai_summary')),
  ai_extracted_data  JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_lead_access" ON lead_notes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM leads
    WHERE id = lead_notes.lead_id
    AND (created_by = auth.uid() OR assigned_to = auth.uid())
  )
);
CREATE POLICY "notes_admin" ON lead_notes FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- EMAIL TEMPLATES
-- ─────────────────────────────────────────
CREATE TABLE email_templates (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  template_type  TEXT DEFAULT 'custom'
                   CHECK (template_type IN (
                     'initial_followup','second_chase','not_now_nurture',
                     'audit_confirmation','proposal_followup','custom'
                   )),
  is_default     BOOLEAN DEFAULT false,
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates_read_all"  ON email_templates FOR SELECT USING (is_default = true OR auth.uid() = created_by);
CREATE POLICY "templates_own_write" ON email_templates FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "templates_admin"     ON email_templates FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- EMAIL SEQUENCES
-- ─────────────────────────────────────────
CREATE TABLE email_sequences (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  steps        JSONB NOT NULL DEFAULT '[]',
  is_default   BOOLEAN DEFAULT false,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sequences_read"  ON email_sequences FOR SELECT USING (is_default = true OR auth.uid() = created_by);
CREATE POLICY "sequences_write" ON email_sequences FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "sequences_admin" ON email_sequences FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- SEQUENCE ENROLLMENTS
-- ─────────────────────────────────────────
CREATE TABLE sequence_enrollments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id        UUID REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id    UUID REFERENCES email_sequences(id),
  current_step   INTEGER DEFAULT 1,
  next_send_at   TIMESTAMPTZ,
  status         TEXT DEFAULT 'active'
                   CHECK (status IN ('active','paused','completed','cancelled')),
  enrolled_by    UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enrollments_own"   ON sequence_enrollments FOR ALL USING (auth.uid() = enrolled_by);
CREATE POLICY "enrollments_admin" ON sequence_enrollments FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- EMAIL LOGS
-- ─────────────────────────────────────────
CREATE TABLE email_logs (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id                 UUID REFERENCES leads(id) ON DELETE SET NULL,
  sequence_enrollment_id  UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
  sent_by                 UUID REFERENCES profiles(id),
  to_email                TEXT NOT NULL,
  subject                 TEXT NOT NULL,
  body                    TEXT NOT NULL,
  status                  TEXT DEFAULT 'sent'
                            CHECK (status IN ('draft','sent','failed')),
  error_message           TEXT,
  sent_at                 TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "logs_own"   ON email_logs FOR ALL USING (auth.uid() = sent_by);
CREATE POLICY "logs_admin" ON email_logs FOR ALL USING (is_admin());

-- ─────────────────────────────────────────
-- Amendment 4: realtime + indexes
-- ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_next_action ON leads(next_action_date);
CREATE INDEX idx_lead_notes_lead ON lead_notes(lead_id);
