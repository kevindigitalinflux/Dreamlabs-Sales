-- 057: Deep find, a queued background job that discovers a lead's people (Hunter lists across every company domain,
-- Companies House officers run through the wide lookup, team pages, web search) and stores them as contacts.
--
-- SECURITY NOTE (needs review before applying; what changes on which table):
-- * NEW TABLE deep_find_runs. RLS ENABLED.
--     SELECT: any member of the run's org (is_org_member(org_id)).
--     INSERT / DELETE: NO client privileges. Runs are created only by the run-deep-find edge function with the
--             service client, after its own checks (signed-in user, org membership, can_edit_lead per lead, 5 active
--             runs per org, 30 creates per user per day, lead not already queued or running).
--     UPDATE: authenticated may change ONLY (status, cancel_reason) (column grant), only on a run they created or
--             as an org admin (policy), and a guard trigger only allows an ACTIVE run to become cancelled from a
--             signed-in request (finished runs cannot be edited at all).
--     anon: no privileges.
-- * NEW TABLE deep_find_leads. RLS ENABLED.
--     SELECT: members of the org who can also see that lead (is_org_member AND can_view_lead), so a restricted
--             contractor never sees discovered domains / names for a lead outside their pipelines (lesson of 036).
--     INSERT / UPDATE / DELETE: NO client privileges. Only the edge function / engine (service role) writes rows.
--     A partial unique index allows at most one queued or running row per lead, so two runs can never process the
--     same lead at once.
-- * NEW SECURITY DEFINER FUNCTIONS, all SET search_path = '', EXECUTE revoked from PUBLIC/anon/authenticated and
--   granted to service_role only: deep_find_increment (counter adjustment), deep_find_reserve (atomic
--   check-and-spend against the caps, the no-overspend guard), deep_find_claim (atomic claim with FOR UPDATE SKIP
--   LOCKED, the overlapping-tick guard), deep_find_creator_can_edit (can_edit_lead for an explicit user id, used by
--   the engine to re-check the run creator's rights before each lead; can_edit_lead itself reads auth.uid()).
-- * The Hunter cap and counter are in Hunter CREDITS (one unit per Hunter request the engine makes, each request
--   limited so it costs at most about one credit).
-- * NEW pg_cron JOB run-deep-find-tick every 2 minutes, same vault cron_secret pattern as migration 049
--   (x-cron-secret header read from vault.decrypted_secrets inside the job; the secret is never in this file).
-- * Both tables join the supabase_realtime publication (postgres_changes respects the SELECT policies above).
-- No existing table, policy or grant is changed.

-- 1. Tables -------------------------------------------------------------------------
CREATE TABLE deep_find_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  lead_count INT NOT NULL CHECK (lead_count BETWEEN 1 AND 25),
  -- Hunter CREDITS (see the security note), not calls.
  credit_cap_hunter INT NOT NULL DEFAULT 60 CHECK (credit_cap_hunter BETWEEN 0 AND 500),
  credit_cap_ai INT NOT NULL DEFAULT 25 CHECK (credit_cap_ai BETWEEN 0 AND 200),
  hunter_used INT NOT NULL DEFAULT 0 CHECK (hunter_used >= 0),
  ai_used INT NOT NULL DEFAULT 0 CHECK (ai_used >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  cancel_reason TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 300),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deep_find_runs_org ON deep_find_runs(org_id, started_at DESC);
CREATE INDEX idx_deep_find_runs_active ON deep_find_runs(status) WHERE status = 'active';

CREATE TABLE deep_find_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES deep_find_runs(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  people_found INT NOT NULL DEFAULT 0 CHECK (people_found >= 0),
  -- {"domains":[{domain,sources,needs_check}], "named_by_web":[{name,role}], "steps":[...]}: engine-written summary.
  domains JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INT NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, lead_id)
);
CREATE INDEX idx_deep_find_leads_run ON deep_find_leads(run_id, status);
CREATE INDEX idx_deep_find_leads_lead ON deep_find_leads(lead_id);
CREATE INDEX idx_deep_find_leads_queued ON deep_find_leads(updated_at) WHERE status = 'queued';
-- One queued or running row per lead across all runs (two runs never process one lead at once).
CREATE UNIQUE INDEX deep_find_leads_one_open_per_lead ON deep_find_leads(lead_id) WHERE status IN ('queued', 'running');

ALTER TABLE deep_find_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deep_find_leads ENABLE ROW LEVEL SECURITY;

-- 2. Grants (tables in public get broad default grants: narrow them explicitly) --------
REVOKE ALL ON deep_find_runs FROM anon, authenticated;
REVOKE ALL ON deep_find_leads FROM anon, authenticated;
GRANT SELECT ON deep_find_runs TO authenticated;
GRANT UPDATE (status, cancel_reason) ON deep_find_runs TO authenticated;
GRANT SELECT ON deep_find_leads TO authenticated;
GRANT ALL ON deep_find_runs, deep_find_leads TO service_role;

-- 3. Policies -------------------------------------------------------------------------
CREATE POLICY "deep_find_runs_select" ON deep_find_runs FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "deep_find_runs_update" ON deep_find_runs FOR UPDATE
  USING (is_org_member(org_id) AND (created_by = auth.uid() OR is_org_admin(org_id)))
  WITH CHECK (is_org_member(org_id) AND (created_by = auth.uid() OR is_org_admin(org_id)));

CREATE POLICY "deep_find_leads_select" ON deep_find_leads FOR SELECT
  USING (is_org_member(org_id) AND can_view_lead(lead_id));

-- 4. Guards ---------------------------------------------------------------------------
-- A signed-in request may only cancel an active run. Service role (engine) has no auth.uid() and is unrestricted.
CREATE OR REPLACE FUNCTION public.deep_find_runs_guard_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- Signed-in requests may only touch an ACTIVE run, and may only leave it active or cancel it.
  IF OLD.status = 'active' AND NEW.status IN ('active', 'cancelled') THEN
    IF NEW.status = 'cancelled' THEN NEW.finished_at := now(); END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A deep find can only be cancelled from the app';
END;
$$;
CREATE TRIGGER deep_find_runs_guard_status BEFORE UPDATE ON deep_find_runs
  FOR EACH ROW EXECUTE FUNCTION public.deep_find_runs_guard_status();

-- 5. Engine RPCs (service role only) ----------------------------------------------------
-- Adjusts the counters (never below zero). Used to record work that was already done.
CREATE OR REPLACE FUNCTION public.deep_find_increment(run_id UUID, hunter INT, ai INT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.deep_find_runs
     SET hunter_used = GREATEST(0, hunter_used + COALESCE(hunter, 0)),
         ai_used = GREATEST(0, ai_used + COALESCE(ai, 0)),
         updated_at = now()
   WHERE id = run_id;
$$;

-- Spends credits BEFORE a provider call: succeeds only while the run is active and the spend stays inside both caps.
-- One statement, so two overlapping ticks can never spend past a cap together.
CREATE OR REPLACE FUNCTION public.deep_find_reserve(run_id UUID, hunter INT, ai INT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH r AS (
    UPDATE public.deep_find_runs
       SET hunter_used = hunter_used + GREATEST(0, COALESCE(hunter, 0)),
           ai_used = ai_used + GREATEST(0, COALESCE(ai, 0)),
           updated_at = now()
     WHERE id = run_id AND status = 'active'
       AND hunter_used + GREATEST(0, COALESCE(hunter, 0)) <= credit_cap_hunter
       AND ai_used + GREATEST(0, COALESCE(ai, 0)) <= credit_cap_ai
    RETURNING true AS ok
  )
  SELECT COALESCE((SELECT ok FROM r), false);
$$;

-- Claims up to max_leads queued rows of active runs (at most 10), oldest first. SKIP LOCKED means two overlapping
-- ticks never claim the same row.
CREATE OR REPLACE FUNCTION public.deep_find_claim(max_leads INT)
RETURNS SETOF public.deep_find_leads
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.deep_find_leads l
     SET status = 'running', claimed_at = now(), updated_at = now(), attempts = l.attempts + 1
   WHERE l.id IN (
     SELECT q.id FROM public.deep_find_leads q
       JOIN public.deep_find_runs r ON r.id = q.run_id
      WHERE q.status = 'queued' AND r.status = 'active'
      ORDER BY q.updated_at, q.id
      LIMIT LEAST(GREATEST(COALESCE(max_leads, 0), 0), 10)
      FOR UPDATE OF q SKIP LOCKED
   )
  RETURNING l.*;
$$;

-- can_edit_lead (migrations 018/019) for an explicit user instead of auth.uid(): admin of the lead's org; or, in the
-- org's default pipeline, a member who created, owns (created_by NULL) or is assigned the lead; or, in a named
-- pipeline, its creator (can_edit_pipeline). Keep in step with can_edit_lead / can_edit_pipeline.
CREATE OR REPLACE FUNCTION public.deep_find_creator_can_edit(target_user UUID, target_lead UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leads l JOIN public.pipelines p ON p.id = l.pipeline_id
     WHERE l.id = target_lead AND (
       EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.org_id AND m.user_id = target_user AND m.role = 'admin')
       OR (p.is_default
           AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.org_id AND m.user_id = target_user)
           AND (l.created_by IS NULL OR l.created_by = target_user OR l.assigned_to = target_user))
       OR (NOT p.is_default AND p.created_by = target_user)
     )
  );
$$;

REVOKE ALL ON FUNCTION public.deep_find_creator_can_edit(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_creator_can_edit(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.deep_find_increment(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deep_find_reserve(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deep_find_claim(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_increment(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.deep_find_reserve(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.deep_find_claim(INT) TO service_role;

-- 6. Realtime ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE deep_find_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE deep_find_leads;

-- 7. Cron tick, same vault-secret pattern as run-selected-autopilot-tick (049) --------------
SELECT cron.schedule(
  'run-deep-find-tick', '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/run-deep-find',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{"action":"tick"}'::jsonb
  );
  $$
);
