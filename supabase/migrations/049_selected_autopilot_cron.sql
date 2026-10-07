-- 049: selected-leads autopilot engine support.
-- 1. send_started_at marker (crash-safe double-send guard).
-- 2. Atomic counter RPCs (supabase-js cannot do col = col + n); service_role only.
-- 3. Security: engine inputs (counters, caps, window, created_by, mode, queue rows) are no longer client-writable.
--    NOTE: this changes existing RLS policies on autopilot_runs / autopilot_run_leads (security review required).
-- 4. pg_cron tick every 2 minutes, same vault-secret pattern as run-autopilot-daily (migration 006).

-- 1 ---------------------------------------------------------------------------
ALTER TABLE autopilot_run_leads ADD COLUMN send_started_at TIMESTAMPTZ;

-- 2 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.autopilot_run_increment(run_id UUID, sent INT, cost_cents INT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.autopilot_runs
     SET outreach_sent_total = GREATEST(0, COALESCE(outreach_sent_total, 0) + COALESCE(sent, 0)),
         actual_ai_cost_cents = GREATEST(0, COALESCE(actual_ai_cost_cents, 0) + COALESCE(cost_cents, 0))
   WHERE id = run_id;
$$;

-- Reserve one send slot BEFORE sending: succeeds only while the run is active and under its daily cap.
CREATE OR REPLACE FUNCTION public.autopilot_reserve_send(run_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH r AS (
    UPDATE public.autopilot_runs
       SET outreach_sent_total = outreach_sent_total + 1
     WHERE id = run_id AND status = 'active'
       AND (daily_send_cap IS NULL OR outreach_sent_total < daily_send_cap)
    RETURNING true AS ok
  )
  SELECT COALESCE((SELECT ok FROM r), false);
$$;

-- Give a reserved slot back when the send fails.
CREATE OR REPLACE FUNCTION public.autopilot_release_send(run_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.autopilot_runs
     SET outreach_sent_total = GREATEST(0, COALESCE(outreach_sent_total, 0) - 1)
   WHERE id = run_id;
$$;

REVOKE ALL ON FUNCTION public.autopilot_run_increment(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.autopilot_reserve_send(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.autopilot_release_send(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.autopilot_run_increment(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.autopilot_reserve_send(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.autopilot_release_send(UUID) TO service_role;

-- 3a. autopilot_runs: split the broad FOR ALL policy ------------------------------
DROP POLICY "autopilot_runs_org_member" ON autopilot_runs;
CREATE POLICY "autopilot_runs_select" ON autopilot_runs FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "autopilot_runs_insert" ON autopilot_runs FOR INSERT
  WITH CHECK (is_org_member(org_id) AND created_by = auth.uid()
              AND status = 'active' AND outreach_sent_total = 0 AND actual_ai_cost_cents = 0);
CREATE POLICY "autopilot_runs_update" ON autopilot_runs FOR UPDATE
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "autopilot_runs_delete" ON autopilot_runs FOR DELETE USING (is_org_member(org_id));

-- 3b. Browsers may only change status / cancel_reason (the Stop button), and only to 'cancelled'.
REVOKE UPDATE ON autopilot_runs FROM authenticated;
GRANT UPDATE (status, cancel_reason) ON autopilot_runs TO authenticated;

CREATE OR REPLACE FUNCTION public.autopilot_runs_guard_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Service role (engine, other edge functions) has no auth.uid() and is unrestricted.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = OLD.status OR (NEW.status = 'cancelled' AND OLD.status = 'active') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'A run can only be cancelled from the app';
END;
$$;
CREATE TRIGGER autopilot_runs_guard_status BEFORE UPDATE ON autopilot_runs
  FOR EACH ROW EXECUTE FUNCTION public.autopilot_runs_guard_status();

-- 3c. autopilot_run_leads: members may read and enqueue; only the engine changes rows ---
DROP POLICY "autopilot_run_leads_org_member" ON autopilot_run_leads;
CREATE POLICY "autopilot_run_leads_select" ON autopilot_run_leads FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "autopilot_run_leads_insert" ON autopilot_run_leads FOR INSERT
  WITH CHECK (
    is_org_member(org_id) AND status = 'queued'
    AND reason IS NULL AND email_log_id IS NULL AND sequence_id IS NULL AND claimed_at IS NULL AND send_started_at IS NULL
    AND EXISTS (SELECT 1 FROM autopilot_runs r WHERE r.id = autopilot_run_leads.run_id AND r.org_id = autopilot_run_leads.org_id)
    AND EXISTS (SELECT 1 FROM leads l WHERE l.id = autopilot_run_leads.lead_id AND l.org_id = autopilot_run_leads.org_id)
  );
REVOKE UPDATE, DELETE ON autopilot_run_leads FROM authenticated;

-- 4 ---------------------------------------------------------------------------
SELECT cron.schedule(
  'run-selected-autopilot-tick', '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/run-selected-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{"action":"tick"}'::jsonb
  );
  $$
);
