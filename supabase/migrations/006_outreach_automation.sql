-- supabase/migrations/006_outreach_automation.sql
-- Outreach automation: cold email + JV pitch (sequence-engine extension), LinkedIn DM (new),
-- reply detection (IMAP), autopilot mode + guardrails. See
-- docs/superpowers/specs/2026-09-03-outreach-automation-design.md.

-- ── 1. Sequence-engine extensions ───────────────────────────────────────
ALTER TABLE leads ADD COLUMN is_priority boolean NOT NULL DEFAULT false;
ALTER TABLE email_sequences ADD COLUMN auto_draft_on_reply boolean NOT NULL DEFAULT false;

-- ── 2. Reply detection ──────────────────────────────────────────────────
ALTER TABLE user_email_settings ADD COLUMN imap_host text;
ALTER TABLE user_email_settings ADD COLUMN imap_port integer;
ALTER TABLE user_email_settings ADD COLUMN last_imap_check_at timestamptz;
ALTER TABLE email_logs ADD COLUMN message_id text;

CREATE TABLE email_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_log_id uuid NOT NULL REFERENCES email_logs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id),
  from_email text NOT NULL,
  subject text,
  body text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_replies_org_read" ON email_replies FOR SELECT
  USING (is_org_member(org_id));
CREATE POLICY "email_replies_org_admin_all" ON email_replies FOR ALL
  USING (is_org_admin(org_id));

-- ── 3. LinkedIn DM ──────────────────────────────────────────────────────
CREATE TABLE linkedin_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  full_name text NOT NULL,
  linkedin_url text,
  context_signal text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','drafted','approved','sent','skipped')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE linkedin_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_contacts_org_member" ON linkedin_contacts FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE TABLE linkedin_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES linkedin_contacts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id),
  message text NOT NULL,
  template_variant text NOT NULL CHECK (template_variant IN ('achievement','life_update','general')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','skipped')),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE linkedin_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_drafts_org_member" ON linkedin_drafts FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

-- ── 4. Autopilot mode ───────────────────────────────────────────────────
CREATE TABLE autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid NOT NULL REFERENCES profiles(id),
  icp_raw_input text NOT NULL,
  icp_params jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('google_places','companies_house')),
  daily_lead_target integer NOT NULL CHECK (daily_lead_target BETWEEN 1 AND 60),
  daily_outreach_target integer NOT NULL CHECK (daily_outreach_target BETWEEN 1 AND 100),
  duration_days integer NOT NULL CHECK (duration_days IN (1, 7, 14, 21, 30)),
  ramp_up_enabled boolean NOT NULL DEFAULT true,
  max_total_spend_cents integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  cancel_reason text,
  estimated_cost_low_cents integer NOT NULL,
  estimated_cost_high_cents integer NOT NULL,
  leads_scraped_total integer NOT NULL DEFAULT 0,
  outreach_sent_total integer NOT NULL DEFAULT 0,
  actual_ai_cost_cents integer NOT NULL DEFAULT 0,
  bounce_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE autopilot_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "autopilot_runs_org_member" ON autopilot_runs FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE UNIQUE INDEX autopilot_runs_one_active_per_org
  ON autopilot_runs(org_id) WHERE status = 'active';

CREATE TABLE outreach_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  value text NOT NULL,
  reason text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, value)
);
ALTER TABLE outreach_blocklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_blocklist_org_member" ON outreach_blocklist FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

-- ── 5. Anthropic as a BYO provider ──────────────────────────────────────
ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider = ANY (ARRAY['gemini','google_places','companies_house','apollo','hunter','anthropic']));

-- ── 5b. Extend template_type constraint for new seed content ───────────
-- email_templates_template_type_check (001_initial_schema.sql) predates this
-- plan and does not include the new outreach template types — extend it the
-- same way section 5 extends org_api_settings_provider_check.
ALTER TABLE email_templates DROP CONSTRAINT email_templates_template_type_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_template_type_check
  CHECK (template_type IN (
    'initial_followup','second_chase','not_now_nurture',
    'audit_confirmation','proposal_followup','custom',
    'cold_outreach_1','cold_outreach_2','cold_outreach_3',
    'jv_pitch_1','jv_pitch_2'
  ));

-- ── 6. Seed content: cold email + JV pitch templates/sequences ─────────
-- Org ids are looked up by name — stable across environments since these are
-- the two real orgs this ships to first (see spec: rollout order).
DO $$
DECLARE
  mr_brush_id uuid := (SELECT id FROM organizations WHERE name = 'Mr Brush & Co');
  di_dreamlabs_id uuid := (SELECT id FROM organizations WHERE name = 'DI Dreamlabs');
  cold1 uuid; cold2 uuid; cold3 uuid; jv1 uuid; jv2 uuid;
  org_row uuid;
BEGIN
  FOREACH org_row IN ARRAY ARRAY[mr_brush_id, di_dreamlabs_id]
  LOOP
    INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
    VALUES (org_row, 'Cold outreach 1', 'quick one for {{company}}',
$body$Hi {{first_name}},

I'm a product designer who taught myself to build full-stack AI systems, the same skills I used to build the operating software for my own commercial cleaning company, Mr Brush & Co.

I'm taking on 5 free case-study builds this quarter for businesses like {{company}}, no cost, I just need your team to actually use it and give me honest feedback.

Worth a 15-minute look at what we'd build for you?

Kevin$body$,
      'cold_outreach_1', true)
    RETURNING id INTO cold1;

    INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
    VALUES (org_row, 'Cold outreach 2', 're: quick one for {{company}}',
$body$Following up, here's what the same kind of system looks like running live at Mr Brush. Happy to walk you through what it'd look like for {{company}} specifically. Worth 15 minutes?$body$,
      'cold_outreach_2', true)
    RETURNING id INTO cold2;

    INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
    VALUES (org_row, 'Cold outreach 3', 'closing this out',
$body$I'm capping the free case-study spots at 5 this round and I've got a couple left. If it's not a fit right now, no worries, I'll leave it here. If you want in, just reply "yes" and I'll send next steps.$body$,
      'cold_outreach_3', true)
    RETURNING id INTO cold3;

    INSERT INTO email_sequences (org_id, name, description, steps, is_default, auto_draft_on_reply)
    VALUES (org_row, 'Cold outreach default', 'Auto-enrollment target for newly-approved leads',
      jsonb_build_array(
        jsonb_build_object('delay_days', 0, 'template_type', 'cold_outreach_1', 'subject_override', NULL),
        jsonb_build_object('delay_days', 3, 'template_type', 'cold_outreach_2', 'subject_override', NULL),
        jsonb_build_object('delay_days', 7, 'template_type', 'cold_outreach_3', 'subject_override', NULL)
      ), true, true);
  END LOOP;

  -- JV pitch: Mr Brush & Co only.
  INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
  VALUES (mr_brush_id, 'JV pitch 1', 'a cleaning offer worth £500 you can sell and keep 100% of',
$body$Hi {{first_name}},

Quick idea, I run Mr Brush & Co, a tech-managed commercial cleaning company in London. I'd like to give you a 3-Month Deep-Clean Office Package (worth £500) to offer your clients, and you keep 100% of whatever you charge for it.

Why would I do that? It gets us in front of facilities that are a great fit for our long-term cleaning contracts, and I'd rather pay for that access in delivered work than ad spend. You get a value-add for your clients and 100% of the revenue, we get the introduction. No cost to you, no risk to your reputation, we deliver, you get the credit.

Worth a quick call to see if it's a fit for your client base?$body$,
    'jv_pitch_1', true)
  RETURNING id INTO jv1;

  INSERT INTO email_templates (org_id, name, subject, body, template_type, is_default)
  VALUES (mr_brush_id, 'JV pitch 2', 're: a cleaning offer worth £500',
$body$Following up on this, happy to send over a one-pager on how the attribution/handoff works if that's useful before a call. Let me know either way.$body$,
    'jv_pitch_2', true)
  RETURNING id INTO jv2;

  INSERT INTO email_sequences (org_id, name, description, steps, is_default, auto_draft_on_reply)
  VALUES (mr_brush_id, 'JV pitch default', 'Manually enrolled JV/partnership contacts',
    jsonb_build_array(
      jsonb_build_object('delay_days', 0, 'template_type', 'jv_pitch_1', 'subject_override', NULL),
      jsonb_build_object('delay_days', 5, 'template_type', 'jv_pitch_2', 'subject_override', NULL)
    ), true, true);
END $$;

-- ── 7. Cron: three new daily jobs, staggered before the existing 06:00 run ─
SELECT cron.schedule(
  'run-autopilot-daily', '40 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/run-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'auto-enroll-cold-outreach-daily', '50 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/auto-enroll-cold-outreach',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'check-replies-daily', '55 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/check-replies',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
