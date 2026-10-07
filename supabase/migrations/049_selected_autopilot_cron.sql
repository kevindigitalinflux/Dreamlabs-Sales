-- 049: selected-leads autopilot engine support.
-- 1. Atomic counter increment (supabase-js cannot do col = col + n).
-- 2. pg_cron tick for run-selected-autopilot every 5 minutes, same vault-secret
--    pattern as run-autopilot-daily (migration 006). cron.schedule upserts by job name.

CREATE OR REPLACE FUNCTION autopilot_run_increment(run_id UUID, sent INT, cost_cents INT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE autopilot_runs
     SET outreach_sent_total = COALESCE(outreach_sent_total, 0) + COALESCE(sent, 0),
         actual_ai_cost_cents = COALESCE(actual_ai_cost_cents, 0) + COALESCE(cost_cents, 0)
   WHERE id = run_id;
$$;

REVOKE ALL ON FUNCTION autopilot_run_increment(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION autopilot_run_increment(UUID, INT, INT) TO service_role;

SELECT cron.schedule(
  'run-selected-autopilot-tick', '*/5 * * * *',
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
