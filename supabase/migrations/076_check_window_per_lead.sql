-- Local draft. Review before applying. No schema, signature or access changes.
BEGIN;
CREATE OR REPLACE FUNCTION public.deep_find_checks_claim(p_max integer) RETURNS SETOF public.deep_find_check_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate public.deep_find_check_queue%rowtype; claimed public.deep_find_check_queue%rowtype;
  domains text[] := '{}'; maximum integer := least(10,greatest(0,coalesce(p_max,0))); used integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
  IF maximum=0 THEN RETURN; END IF;
  FOR candidate IN
    SELECT q.* FROM public.deep_find_check_queue q JOIN public.deep_find_runs r ON r.id=q.run_id AND r.org_id=q.org_id
      WHERE q.status='queued' AND q.next_at<=now() AND r.status IN ('active','completed')
        AND now()<q.created_at+interval '60 minutes' AND now()<r.started_at+interval '3 hours'
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

CREATE OR REPLACE FUNCTION public.deep_find_checks_expire() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recovered integer; expired integer; siblings integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
  UPDATE public.deep_find_check_queue q SET status='queued',next_at=now()
    FROM public.deep_find_runs r WHERE r.id=q.run_id AND r.org_id=q.org_id
      AND q.status='running' AND q.claimed_at<now()-interval '5 minutes'
      AND now()<q.created_at+interval '60 minutes' AND now()<r.started_at+interval '3 hours' AND r.status<>'cancelled';
  GET DIAGNOSTICS recovered = ROW_COUNT;
  UPDATE public.deep_find_check_queue q SET status='skipped',reason='run_time_limit',finished_at=now()
    FROM public.deep_find_runs r WHERE r.id=q.run_id
      AND (q.status='queued' OR (q.status='running' AND (q.claimed_at<now()-interval '5 minutes' OR r.status='cancelled')))
      AND (q.created_at<=now()-interval '60 minutes' OR r.started_at<=now()-interval '3 hours' OR r.status='cancelled');
  GET DIAGNOSTICS expired = ROW_COUNT;
  UPDATE public.deep_find_check_queue q SET status='skipped',reason='person_done',finished_at=now()
    WHERE q.status='queued' AND q.person_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.deep_find_check_queue proven WHERE proven.run_id=q.run_id AND proven.org_id=q.org_id
        AND proven.lead_id=q.lead_id AND proven.person_key=q.person_key AND proven.status='done' AND proven.verdict IN ('valid','exists'));
  GET DIAGNOSTICS siblings = ROW_COUNT;
  RETURN recovered+expired+siblings;
END $$;

REVOKE ALL ON FUNCTION public.deep_find_checks_claim(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deep_find_checks_expire() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_checks_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.deep_find_checks_expire() TO service_role;
CREATE OR REPLACE FUNCTION public.deep_find_checks_finish(p_id uuid,p_status text,p_verdict text,p_reason text,p_provider text,p_next_at timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE changed uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('queued','done','skipped') THEN RAISE EXCEPTION 'Invalid final status'; END IF;
  IF p_status='queued' AND p_next_at IS NULL THEN RAISE EXCEPTION 'Retry time required'; END IF;
  UPDATE public.deep_find_check_queue SET status=p_status,verdict=p_verdict,reason=p_reason,provider=p_provider,
    attempts=CASE WHEN p_status='queued' AND p_reason='domain_stalled' THEN greatest(0,attempts-1) ELSE attempts END,
    next_at=coalesce(p_next_at,next_at),finished_at=CASE WHEN p_status='queued' THEN NULL ELSE now() END
    WHERE id=p_id AND status='running' RETURNING id INTO changed;
  RETURN changed IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION public.deep_find_checks_finish(uuid,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_checks_finish(uuid,text,text,text,text,timestamptz) TO service_role;
COMMIT;
