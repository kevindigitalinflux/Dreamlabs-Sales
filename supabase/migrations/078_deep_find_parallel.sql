-- Local draft only. Review and rolled-back fixture audit before applying.
CREATE OR REPLACE FUNCTION public.deep_find_complete(p_run uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 UPDATE public.deep_find_runs r SET status='completed',finished_at=now(),updated_at=now()
 WHERE r.id=p_run AND r.status='active'
 AND (SELECT count(*) FROM public.deep_find_leads q WHERE q.run_id=r.id)>=r.lead_count
 AND NOT EXISTS(SELECT 1 FROM public.deep_find_leads q WHERE q.run_id=r.id AND q.status IN ('queued','running'))
 RETURNING r.id INTO changed;
 RETURN changed IS NOT NULL;
END $$;
CREATE OR REPLACE FUNCTION public.deep_find_housekeeping() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; run_record record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 UPDATE public.deep_find_leads q SET
 status=CASE WHEN q.attempts>=2 THEN 'failed' ELSE 'queued' END,
 reason=CASE WHEN q.attempts>=2 THEN 'This lead was interrupted twice, so Deep find stopped trying.' ELSE q.reason END,
 finished_at=CASE WHEN q.attempts>=2 THEN now() ELSE NULL END,
 claimed_at=CASE WHEN q.attempts>=2 THEN q.claimed_at ELSE NULL END,updated_at=now()
 WHERE q.status='running' AND (q.claimed_at IS NULL OR q.claimed_at<=now()-interval '10 minutes');
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE public.deep_find_leads q SET status='skipped',reason='The Deep find was stopped before this lead.',updated_at=now()
 FROM public.deep_find_runs r WHERE r.id=q.run_id AND r.status<>'active' AND q.status='queued';
 FOR run_record IN SELECT id FROM public.deep_find_runs WHERE status='active' LOOP
  PERFORM public.deep_find_complete(run_record.id);
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.deep_find_complete(uuid), public.deep_find_housekeeping() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_complete(uuid), public.deep_find_housekeeping() TO service_role;

-- Task 2: database-owned tuning; no browser write/read grant.
CREATE TABLE public.deep_find_runtime_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 deep_find_parallel integer NOT NULL DEFAULT 3 CHECK(deep_find_parallel BETWEEN 1 AND 5)
);
ALTER TABLE public.deep_find_runtime_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deep_find_runtime_config FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.deep_find_runtime_config TO service_role;
INSERT INTO public.deep_find_runtime_config(singleton) VALUES(true) ON CONFLICT DO NOTHING;
SELECT cron.schedule('run-deep-find-tick','*/2 * * * *',$cron$
 SELECT net.http_post(
  url:='https://wgomksxelyfkzepbnkdd.supabase.co/functions/v1/run-deep-find',
  headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',
   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret')),
  body:='{"action":"tick"}'::jsonb)
 FROM generate_series(1,(SELECT deep_find_parallel FROM public.deep_find_runtime_config WHERE singleton));
$cron$);

-- Task 3: serialize only claim selection, never lead work. The next statement sees a fresh snapshot.
CREATE OR REPLACE FUNCTION public.deep_find_claim(max_leads integer) RETURNS SETOF public.deep_find_leads
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_id uuid; claimed public.deep_find_leads%rowtype; n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.deep_find_runtime_config WHERE singleton FOR UPDATE;
 FOR n IN 1..least(10,greatest(0,coalesce(max_leads,0))) LOOP
  SELECT q.id INTO selected_id FROM public.deep_find_leads q JOIN public.deep_find_runs r ON r.id=q.run_id
  WHERE q.status='queued' AND r.status='active'
  ORDER BY (SELECT count(*) FROM public.deep_find_leads running WHERE running.run_id=q.run_id AND running.status='running'),
   r.started_at,q.updated_at,q.id
  LIMIT 1 FOR UPDATE OF q SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.deep_find_leads SET status='running',claimed_at=now(),updated_at=now(),attempts=attempts+1
   WHERE id=selected_id AND status='queued' RETURNING * INTO claimed;
  IF FOUND THEN RETURN NEXT claimed; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.deep_find_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_claim(integer) TO service_role;
