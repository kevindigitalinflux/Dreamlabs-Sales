-- Stage 2 background lookups. REVIEW REQUIRED; Kevin applies after architect review.
-- Clients can read jobs and delete ended jobs they created (or as org admin).
-- No client INSERT/UPDATE, including result/review fields. The review RPC is the only review write.
-- SECURITY QUESTION: lookup_job_leads SELECT policy intentionally withheld pending resolution
-- of org-wide visibility in the Stage 2 spec versus can_view_lead in migration 057.
-- Do not apply/deploy until that policy and the corresponding audit expectations are approved.
BEGIN;

CREATE TABLE public.lookup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  kind text NOT NULL CHECK (kind IN ('enrich', 'decision_makers')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  lead_count int NOT NULL CHECK (lead_count BETWEEN 1 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (id, org_id)
);
CREATE INDEX lookup_jobs_org ON public.lookup_jobs(org_id, created_at DESC);
CREATE TABLE public.lookup_job_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  reason text CHECK (length(reason) <= 1000),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  review text NOT NULL DEFAULT 'none' CHECK (review IN ('none', 'pending', 'applied', 'dismissed')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
  claimed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, org_id) REFERENCES public.lookup_jobs(id, org_id) ON DELETE CASCADE,
  UNIQUE (job_id, lead_id),
  CHECK (review = 'none' OR status = 'done')
);
CREATE INDEX lookup_job_leads_queue ON public.lookup_job_leads(status, updated_at);
CREATE INDEX lookup_job_leads_lead ON public.lookup_job_leads(lead_id);
ALTER TABLE public.lookup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lookup_job_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lookup_jobs, public.lookup_job_leads FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.lookup_jobs TO authenticated;
GRANT SELECT ON public.lookup_job_leads TO authenticated;
GRANT ALL ON public.lookup_jobs, public.lookup_job_leads TO service_role;
CREATE POLICY lookup_jobs_select ON public.lookup_jobs FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY lookup_jobs_delete ON public.lookup_jobs FOR DELETE TO authenticated
  USING (public.is_org_member(org_id) AND status <> 'active'
    AND (created_by = auth.uid() OR public.is_org_admin(org_id)));
-- lookup_job_leads SELECT policy: BLOCKED, see security question above.

-- Transactional create: no partially queued job, and tenant/edit checks repeated inside the write.
CREATE FUNCTION public.lookup_job_create(target_org uuid, creator uuid, job_kind text, lead_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_job uuid; n int;
BEGIN
  SELECT count(DISTINCT x) INTO n FROM unnest(lead_ids) x;
  IF n NOT BETWEEN 1 AND 50 OR cardinality(lead_ids) <> n OR job_kind NOT IN ('enrich', 'decision_makers') THEN
    RAISE EXCEPTION 'Invalid lookup request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = target_org AND user_id = creator)
    OR (SELECT count(*) FROM public.leads WHERE id = ANY(lead_ids) AND org_id = target_org
      AND public.deep_find_creator_can_edit(creator, id)) <> n THEN
    RAISE EXCEPTION 'Selected leads are not editable';
  END IF;
  INSERT INTO public.lookup_jobs(org_id, created_by, kind, lead_count)
    VALUES (target_org, creator, job_kind, n) RETURNING id INTO new_job;
  INSERT INTO public.lookup_job_leads(job_id, org_id, lead_id)
    SELECT new_job, target_org, x FROM unnest(lead_ids) x;
  RETURN new_job;
END;
$$;

-- Cancel and result writes lock the parent first, so a late result cannot resurrect a stopped job.
CREATE FUNCTION public.lookup_job_cancel(target_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.lookup_jobs WHERE id = target_job FOR UPDATE;
  UPDATE public.lookup_jobs SET status = 'cancelled', finished_at = now()
    WHERE id = target_job AND status = 'active';
  UPDATE public.lookup_job_leads SET status = 'skipped', reason = 'This job was stopped.', updated_at = now()
    WHERE job_id = target_job AND status IN ('queued', 'running')
      AND EXISTS (SELECT 1 FROM public.lookup_jobs WHERE id = target_job AND status = 'cancelled');
END;
$$;

-- One running row per organisation keeps the existing checkRateLimit count-and-log sequential.
-- The transaction lock serialises claims only; provider calls happen outside the transaction.
-- A 5-minute lease exceeds the invocation budget. Retry once; attempts fence stale result writes.
CREATE FUNCTION public.lookup_job_claim(max_leads int)
RETURNS SETOF public.lookup_job_leads LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(610015);
  UPDATE public.lookup_job_leads l SET
    status = CASE WHEN j.status <> 'active' THEN 'skipped' WHEN l.attempts < 2 THEN 'queued' ELSE 'failed' END,
    reason = CASE WHEN j.status <> 'active' THEN 'This job was stopped.' WHEN l.attempts >= 2 THEN 'This lead was interrupted twice, so the lookup stopped trying.' ELSE NULL END,
    claimed_at = NULL, updated_at = now()
    FROM public.lookup_jobs j WHERE j.id = l.job_id AND l.status = 'running'
      AND l.claimed_at < now() - interval '5 minutes';
  UPDATE public.lookup_job_leads l SET status = 'skipped', reason = 'This job was stopped.', updated_at = now()
    FROM public.lookup_jobs j WHERE j.id = l.job_id AND j.status <> 'active' AND l.status = 'queued';
  UPDATE public.lookup_jobs j SET status = 'completed', finished_at = now()
    WHERE j.status = 'active' AND NOT EXISTS
      (SELECT 1 FROM public.lookup_job_leads l WHERE l.job_id = j.id AND l.status IN ('queued', 'running'));
  RETURN QUERY
    UPDATE public.lookup_job_leads l SET status = 'running', claimed_at = now(), updated_at = now(), attempts = l.attempts + 1
    WHERE l.id IN (
      SELECT q.id FROM public.lookup_job_leads q JOIN public.lookup_jobs j ON j.id = q.job_id
      WHERE q.status = 'queued' AND j.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM public.lookup_job_leads busy WHERE busy.org_id = q.org_id AND busy.status = 'running')
      ORDER BY q.updated_at, q.id LIMIT LEAST(GREATEST(COALESCE(max_leads, 0), 0), 1)
      FOR UPDATE OF q SKIP LOCKED
    ) RETURNING l.*;
END;
$$;

CREATE FUNCTION public.lookup_job_finish(lead_row uuid, claim_attempt int, new_status text, new_reason text, new_result jsonb, new_review text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE parent uuid; changed int;
BEGIN
  IF new_status NOT IN ('done', 'failed', 'skipped') OR new_review NOT IN ('none', 'pending') THEN
    RAISE EXCEPTION 'Invalid lookup outcome';
  END IF;
  SELECT job_id INTO parent FROM public.lookup_job_leads WHERE id = lead_row;
  PERFORM 1 FROM public.lookup_jobs WHERE id = parent AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.lookup_job_leads SET status = new_status, reason = new_reason, result = new_result,
    review = new_review, updated_at = now()
    WHERE id = lead_row AND status = 'running' AND attempts = claim_attempt;
  GET DIAGNOSTICS changed = ROW_COUNT;
  UPDATE public.lookup_jobs j SET status = 'completed', finished_at = now()
    WHERE j.id = parent AND j.status = 'active' AND NOT EXISTS
      (SELECT 1 FROM public.lookup_job_leads l WHERE l.job_id = parent AND l.status IN ('queued', 'running'));
  RETURN changed = 1;
END;
$$;

CREATE FUNCTION public.lookup_job_review(lead_row uuid, new_review text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed int;
BEGIN
  IF new_review IS NULL OR new_review NOT IN ('applied', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid review choice';
  END IF;
  -- FAIL CLOSED pending the SELECT/review visibility decision: only rows visible through RLS
  -- should be reviewable. This RPC remains disabled until the architect resolves that question.
  RAISE EXCEPTION 'Lookup review policy awaits approval';
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_job_create(uuid, uuid, text, uuid[]), public.lookup_job_cancel(uuid),
  public.lookup_job_claim(int), public.lookup_job_finish(uuid, int, text, text, jsonb, text),
  public.lookup_job_review(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_job_create(uuid, uuid, text, uuid[]), public.lookup_job_cancel(uuid),
  public.lookup_job_claim(int), public.lookup_job_finish(uuid, int, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lookup_job_review(uuid, text) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.lookup_jobs, public.lookup_job_leads;
SELECT cron.schedule('run-lookup-jobs-tick', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/run-lookup-jobs',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')),
    body := '{"action":"tick"}'::jsonb
  );
$cron$);
COMMIT;
