DO $$
BEGIN
  RAISE EXCEPTION 'migration 075 is not approved yet';
END $$;

-- Written only. Claude removes the guard after independent review and Kevin's authorization.
BEGIN;
ALTER TABLE public.email_logs DROP CONSTRAINT email_logs_tier_snapshot_shape;
ALTER TABLE public.email_logs
  ADD CONSTRAINT email_logs_tier_snapshot_shape CHECK (
    (recipient_tier_at_send IS NULL AND recipient_tier_basis IS NULL
      AND recipient_tier_version IS NULL AND recipient_was_sent_ok IS NULL
      AND recipient_tier_recorded_at IS NULL)
    OR
    (recipient_tier_at_send IS NOT NULL AND recipient_tier_at_send IN ('T1','T2','T3')
      AND status IS NOT DISTINCT FROM 'sent' AND sent_at IS NOT NULL
      AND recipient_tier_basis IS NOT NULL AND recipient_tier_version = 1
      AND recipient_tier_version IS NOT NULL AND recipient_was_sent_ok IS NOT NULL
      AND recipient_tier_recorded_at IS NOT NULL AND recipient_tier_recorded_at >= sent_at
      AND (NOT recipient_was_sent_ok OR recipient_tier_at_send = 'T1')
      AND ((recipient_tier_at_send = 'T1' AND recipient_tier_basis IN
        ('checker_valid','replied','sent_ok','company_site','places','saved_non_guessed','ms_exists','role_confirmed'))
        OR (recipient_tier_at_send = 'T2' AND recipient_tier_basis = 'supported_pattern')
        OR (recipient_tier_at_send = 'T3' AND recipient_tier_basis IN
          ('evidence_mismatch','role_review','pattern_paused','weak_evidence','ms_not_found','saved_unproven')))
      AND (recipient_tier_basis <> 'sent_ok' OR recipient_was_sent_ok))
  );

CREATE TABLE public.deep_find_check_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.deep_find_runs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.decision_maker_candidates(id) ON DELETE SET NULL,
  person_key text,
  person_name text CHECK (char_length(person_name) <= 120),
  address text NOT NULL CHECK (address = lower(address) AND char_length(address) <= 254),
  domain text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('smtp','ms_exists')),
  rank smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','skipped')),
  verdict text CHECK (verdict IN ('valid','invalid','unverifiable','exists','not_found')),
  reason text CHECK (char_length(reason) <= 60),
  provider text CHECK (provider IN ('google','microsoft','hosted','unknown')),
  attempts smallint NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, address, kind)
);
CREATE INDEX deep_find_check_queue_due ON public.deep_find_check_queue(status,next_at);
CREATE INDEX deep_find_check_queue_lead ON public.deep_find_check_queue(lead_id);
ALTER TABLE public.deep_find_check_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY deep_find_check_queue_read ON public.deep_find_check_queue FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_view_lead(lead_id));
REVOKE ALL ON public.deep_find_check_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deep_find_check_queue TO authenticated;
GRANT ALL ON public.deep_find_check_queue TO service_role;

CREATE FUNCTION public.deep_find_checks_enqueue(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item jsonb; org uuid; run uuid; lead uuid; contact uuid; inserted integer; total integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Rows must be an array'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) WITH ORDINALITY rows(value,n) WHERE n <= 200 LOOP
    org := (item->>'org_id')::uuid; run := (item->>'run_id')::uuid;
    lead := (item->>'lead_id')::uuid; contact := (item->>'contact_id')::uuid;
    -- The run lock serializes competing enqueues before the per-lead count and unique insert.
    PERFORM 1 FROM public.deep_find_runs r WHERE r.id=run AND r.org_id=org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Run not in organisation'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=lead AND l.org_id=org) THEN RAISE EXCEPTION 'Lead not in organisation'; END IF;
    IF contact IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.decision_maker_candidates c WHERE c.id=contact AND c.lead_id=lead)
      THEN RAISE EXCEPTION 'Contact not on lead'; END IF;
    IF (SELECT count(*) FROM public.deep_find_check_queue q WHERE q.run_id=run AND q.lead_id=lead) >= 30 THEN CONTINUE; END IF;
    INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,contact_id,person_key,person_name,address,domain,kind,rank)
      VALUES(org,run,lead,contact,item->>'person_key',item->>'person_name',item->>'address',item->>'domain',item->>'kind',coalesce((item->>'rank')::smallint,0))
      ON CONFLICT (run_id,address,kind) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT; total := total + inserted;
  END LOOP;
  RETURN total;
END $$;

CREATE FUNCTION public.deep_find_checks_claim(p_max integer) RETURNS SETOF public.deep_find_check_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate public.deep_find_check_queue%rowtype; claimed public.deep_find_check_queue%rowtype;
  domains text[] := '{}'; maximum integer := least(10,greatest(0,coalesce(p_max,0))); used integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
  IF maximum=0 THEN RETURN; END IF;
  FOR candidate IN
    SELECT q.* FROM public.deep_find_check_queue q JOIN public.deep_find_runs r ON r.id=q.run_id AND r.org_id=q.org_id
      WHERE q.status='queued' AND q.next_at<=now() AND r.status IN ('active','completed')
        AND now()<r.started_at+interval '60 minutes'
      ORDER BY q.rank,q.next_at,q.created_at,q.id LIMIT 200 FOR UPDATE OF q SKIP LOCKED
  LOOP
    IF candidate.domain=ANY(domains) THEN CONTINUE; END IF;
    -- Atomic across overlapping claim calls, runs and organisations; no domain starts a fifth call in a minute.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('deep-find-check-domain:'||candidate.domain,0)) THEN CONTINUE; END IF;
    IF (SELECT count(*) FROM public.deep_find_check_queue q WHERE q.domain=candidate.domain AND q.claimed_at>now()-interval '60 seconds') >= 4
      THEN CONTINUE; END IF;
    UPDATE public.deep_find_check_queue SET status='running',claimed_at=now(),attempts=attempts+1
      WHERE id=candidate.id AND status='queued' RETURNING * INTO claimed;
    IF FOUND THEN
      domains := array_append(domains,candidate.domain); used := used+1;
      RETURN NEXT claimed;
    END IF;
    EXIT WHEN used>=maximum;
  END LOOP;
END $$;

CREATE FUNCTION public.deep_find_checks_finish(p_id uuid,p_status text,p_verdict text,p_reason text,p_provider text,p_next_at timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE changed uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('queued','done','skipped') THEN RAISE EXCEPTION 'Invalid final status'; END IF;
  IF p_status='queued' AND p_next_at IS NULL THEN RAISE EXCEPTION 'Retry time required'; END IF;
  UPDATE public.deep_find_check_queue SET status=p_status,verdict=p_verdict,reason=p_reason,provider=p_provider,
    next_at=coalesce(p_next_at,next_at),finished_at=CASE WHEN p_status='queued' THEN NULL ELSE now() END
    WHERE id=p_id AND status='running' RETURNING id INTO changed;
  RETURN changed IS NOT NULL;
END $$;

CREATE FUNCTION public.deep_find_checks_expire() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recovered integer; expired integer; siblings integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
  UPDATE public.deep_find_check_queue q SET status='queued',next_at=now()
    FROM public.deep_find_runs r WHERE r.id=q.run_id AND r.org_id=q.org_id
      AND q.status='running' AND q.claimed_at<now()-interval '5 minutes'
      AND now()<r.started_at+interval '60 minutes' AND r.status<>'cancelled';
  GET DIAGNOSTICS recovered = ROW_COUNT;
  UPDATE public.deep_find_check_queue q SET status='skipped',reason='run_time_limit',finished_at=now()
    FROM public.deep_find_runs r WHERE r.id=q.run_id
      AND (q.status='queued' OR (q.status='running' AND q.claimed_at<now()-interval '5 minutes'))
      AND (r.started_at<now()-interval '60 minutes' OR r.status='cancelled');
  GET DIAGNOSTICS expired = ROW_COUNT;
  UPDATE public.deep_find_check_queue q SET status='skipped',reason='person_done',finished_at=now()
    WHERE q.status='queued' AND q.person_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.deep_find_check_queue proven WHERE proven.run_id=q.run_id AND proven.org_id=q.org_id
        AND proven.lead_id=q.lead_id AND proven.person_key=q.person_key AND proven.status='done' AND proven.verdict IN ('valid','exists'));
  GET DIAGNOSTICS siblings = ROW_COUNT;
  RETURN recovered+expired+siblings;
END $$;

REVOKE ALL ON FUNCTION public.deep_find_checks_enqueue(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deep_find_checks_claim(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deep_find_checks_finish(uuid,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deep_find_checks_expire() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_checks_enqueue(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.deep_find_checks_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.deep_find_checks_finish(uuid,text,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.deep_find_checks_expire() TO service_role;

SELECT cron.schedule('run-verify-queue-tick', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/run-verify-queue',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret')),
    body := '{}'::jsonb
  );
$$);
COMMIT;
