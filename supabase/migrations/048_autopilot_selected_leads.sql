-- 048: autopilot "selected leads" mode.
-- A selected run works through a hand-picked list of leads inside a daily send window
-- instead of scraping for new ones. Adds the mode + window columns, relaxes the
-- discover-only NOT NULL columns a selected run cannot supply, allows one active run
-- PER MODE per org, and adds autopilot_run_leads (the per-lead queue/outcome table).

-- 1. New columns
ALTER TABLE autopilot_runs
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'discover' CHECK (mode IN ('discover','selected')),
  ADD COLUMN window_start TEXT,      -- 'HH:MM' local to timezone
  ADD COLUMN window_end TEXT,        -- 'HH:MM' local to timezone
  ADD COLUMN timezone TEXT,          -- IANA name, e.g. 'Europe/London'
  ADD COLUMN window_date DATE,       -- the local date the window applies to
  ADD COLUMN daily_send_cap INT;

-- 2. Relax discover-only columns (existing discover rows are unaffected; their CHECKs
--    still validate any non-null value, and discover inserts still supply all of these).
ALTER TABLE autopilot_runs
  ALTER COLUMN icp_raw_input SET DEFAULT '',
  ALTER COLUMN icp_params SET DEFAULT '{}'::jsonb,
  ALTER COLUMN source DROP NOT NULL,
  ALTER COLUMN daily_lead_target DROP NOT NULL,
  ALTER COLUMN daily_outreach_target DROP NOT NULL,
  ALTER COLUMN duration_days DROP NOT NULL,
  ALTER COLUMN ends_at DROP NOT NULL,
  ALTER COLUMN estimated_cost_low_cents SET DEFAULT 0,
  ALTER COLUMN estimated_cost_high_cents SET DEFAULT 0;

-- 3. One active run per org PER MODE (a discover run and a selected run may coexist)
DROP INDEX autopilot_runs_one_active_per_org;
CREATE UNIQUE INDEX autopilot_runs_one_active_per_org_mode
  ON autopilot_runs(org_id, mode) WHERE status = 'active';

-- 4. Per-lead queue for selected runs
CREATE TABLE autopilot_run_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES autopilot_runs(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','working','sent','skipped','needs_input','failed','not_reached')),
  reason TEXT,
  email_log_id UUID REFERENCES email_logs(id) ON DELETE SET NULL,
  sequence_id UUID REFERENCES email_sequences(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, lead_id)
);
CREATE INDEX idx_autopilot_run_leads_run ON autopilot_run_leads(run_id, status);
CREATE INDEX idx_autopilot_run_leads_lead ON autopilot_run_leads(lead_id);
ALTER TABLE autopilot_run_leads ENABLE ROW LEVEL SECURITY;
-- Same shape as autopilot_runs_org_member (migration 006); 009 did not touch this table.
CREATE POLICY "autopilot_run_leads_org_member" ON autopilot_run_leads FOR ALL
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
ALTER PUBLICATION supabase_realtime ADD TABLE autopilot_run_leads;
