-- 057: Deep find, a queued background job that discovers a lead's people (Hunter lists across every company domain,
-- Companies House officers run through the wide lookup, team pages, web search) and stores them as contacts.
--
-- SECURITY NOTE (needs review before applying; what changes on which table):
-- * NEW TABLE deep_find_runs. RLS ENABLED.
--     SELECT: any member of the run's org (is_org_member(org_id)).
--     INSERT: only into an org you belong to, as yourself (created_by = auth.uid()), with status 'active', zero
--             counters, no finish time / cancel reason, 1 to 25 leads and caps inside the CHECK bounds.
--     UPDATE: authenticated may change ONLY (status, cancel_reason) (column grant), only on a run they created or
--             as an org admin (policy), and a guard trigger only allows active -> cancelled from a signed-in request.
--     DELETE: no client delete (grant revoked). anon: no privileges at all.
-- * NEW TABLE deep_find_leads. RLS ENABLED.
--     SELECT: members of the org who can also see that lead (is_org_member AND can_view_lead), so a restricted
--             contractor never sees discovered domains / names for a lead outside their pipelines (lesson of 036).
--     INSERT: only status 'queued' rows with empty engine columns, into an ACTIVE run the caller created in the same
--             org, for a lead in that org the caller can edit (can_edit_lead). A SECURITY DEFINER trigger caps the
--             rows per run at the run's lead_count (max 25).
--     UPDATE / DELETE: none for clients (grants revoked). Only the engine (service role) changes rows.
-- * NEW SECURITY DEFINER FUNCTIONS, all SET search_path = '', EXECUTE revoked from PUBLIC/anon/authenticated and
--   granted to service_role only: deep_find_increment (counter adjustment), deep_find_reserve (atomic
--   check-and-spend against the caps, the no-overspend guard), deep_find_claim (atomic claim with FOR UPDATE SKIP
--   LOCKED, the overlapping-tick guard), deep_find_leads_cap (trigger).
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

ALTER TABLE deep_find_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deep_find_leads ENABLE ROW LEVEL SECURITY;

-- 2. Grants (tables in public get broad default grants: narrow them explicitly) --------
REVOKE ALL ON deep_find_runs FROM anon, authenticated;
REVOKE ALL ON deep_find_leads FROM anon, authenticated;
GRANT SELECT, INSERT ON deep_find_runs TO authenticated;
GRANT UPDATE (status, cancel_reason) ON deep_find_runs TO authenticated;
GRANT SELECT, INSERT ON deep_find_leads TO authenticated;
GRANT ALL ON deep_find_runs, deep_find_leads TO service_role;

-- 3. Policies -------------------------------------------------------------------------
CREATE POLICY "deep_find_runs_select" ON deep_find_runs FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "deep_find_runs_insert" ON deep_find_runs FOR INSERT
  WITH CHECK (
    is_org_member(org_id) AND created_by = auth.uid()
    AND status = 'active' AND hunter_used = 0 AND ai_used = 0
    AND finished_at IS NULL AND cancel_reason IS NULL
  );
CREATE POLICY "deep_find_runs_update" ON deep_find_runs FOR UPDATE
  USING (is_org_member(org_id) AND (created_by = auth.uid() OR is_org_admin(org_id)))
  WITH CHECK (is_org_member(org_id) AND (created_by = auth.uid() OR is_org_admin(org_id)));

CREATE POLICY "deep_find_leads_select" ON deep_find_leads FOR SELECT
  USING (is_org_member(org_id) AND can_view_lead(lead_id));
CREATE POLICY "deep_find_leads_insert" ON deep_find_leads FOR INSERT
  WITH CHECK (
    is_org_member(org_id) AND status = 'queued'
    AND reason IS NULL AND people_found = 0 AND domains = '{}'::jsonb AND attempts = 0
    AND claimed_at IS NULL AND finished_at IS NULL
    AND EXISTS (SELECT 1 FROM deep_find_runs r WHERE r.id = deep_find_leads.run_id AND r.org_id = deep_find_leads.org_id
                AND r.created_by = auth.uid() AND r.status = 'active')
    AND EXISTS (SELECT 1 FROM leads l WHERE l.id = deep_find_leads.lead_id AND l.org_id = deep_find_leads.org_id)
    AND can_edit_lead(lead_id)
  );

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
  IF NEW.status = OLD.status OR (NEW.status = 'cancelled' AND OLD.status = 'active') THEN
    IF NEW.status = 'cancelled' AND OLD.status = 'active' THEN NEW.finished_at := now(); END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A deep find can only be cancelled from the app';
END;
$$;
CREATE TRIGGER deep_find_runs_guard_status BEFORE UPDATE ON deep_find_runs
  FOR EACH ROW EXECUTE FUNCTION public.deep_find_runs_guard_status();

-- At most lead_count rows per run (max 25), checked with definer rights so RLS cannot hide rows from the count.
CREATE OR REPLACE FUNCTION public.deep_find_leads_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cap INT;
  have INT;
BEGIN
  SELECT r.lead_count INTO cap FROM public.deep_find_runs r WHERE r.id = NEW.run_id FOR UPDATE;
  IF cap IS NULL THEN RAISE EXCEPTION 'Unknown deep find run'; END IF;
  SELECT count(*) INTO have FROM public.deep_find_leads l WHERE l.run_id = NEW.run_id;
  IF have >= cap THEN RAISE EXCEPTION 'This deep find already has all its leads'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.deep_find_leads_cap() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER deep_find_leads_cap BEFORE INSERT ON deep_find_leads
  FOR EACH ROW EXECUTE FUNCTION public.deep_find_leads_cap();

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
