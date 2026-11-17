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

ALTER TABLE public.deep_find_runtime_config ADD COLUMN gemini_per_minute integer NOT NULL DEFAULT 12 CHECK (gemini_per_minute > 0);
CREATE TABLE public.gemini_minute_usage (minute timestamptz PRIMARY KEY, used integer NOT NULL CHECK (used >= 0));
ALTER TABLE public.gemini_minute_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gemini_minute_usage FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.gemini_minute_usage TO service_role;
CREATE OR REPLACE FUNCTION public.gemini_admit() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE admitted integer; maximum integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 SELECT gemini_per_minute INTO maximum FROM public.deep_find_runtime_config WHERE singleton;
 INSERT INTO public.gemini_minute_usage AS u(minute,used) VALUES(date_trunc('minute',now()),1)
 ON CONFLICT(minute) DO UPDATE SET used=u.used+1 WHERE u.used<maximum RETURNING used INTO admitted;
 DELETE FROM public.gemini_minute_usage WHERE minute < now()-interval '1 day';
 RETURN admitted IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.gemini_admit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gemini_admit() TO service_role;
ALTER TABLE public.deep_find_runs ADD COLUMN notices text[] NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION public.deep_find_notice_once(p_run uuid,p_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 IF p_code NOT IN ('worker_search','worker_verify','worker_scrape') THEN RAISE EXCEPTION 'Invalid notice'; END IF;
 UPDATE public.deep_find_runs SET notices=array_append(notices,p_code)
 WHERE id=p_run AND NOT(p_code=ANY(notices)) RETURNING id INTO changed;
 RETURN changed IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.deep_find_notice_once(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_notice_once(uuid,text) TO service_role;

ALTER TABLE public.deep_find_runs ADD COLUMN deep_find_parallel integer NOT NULL DEFAULT 3 CHECK (deep_find_parallel BETWEEN 1 AND 5);
CREATE OR REPLACE FUNCTION public.deep_find_run_parallel_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 SELECT deep_find_parallel INTO NEW.deep_find_parallel FROM public.deep_find_runtime_config WHERE singleton;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.deep_find_run_parallel_snapshot() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER deep_find_parallel_snapshot BEFORE INSERT ON public.deep_find_runs
 FOR EACH ROW EXECUTE FUNCTION public.deep_find_run_parallel_snapshot();
CREATE OR REPLACE FUNCTION public.deep_find_check_deadline(p_start timestamptz,p_count integer,p_parallel integer) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT p_start + least(interval '8 hours',greatest(interval '3 hours',
 interval '1 minute' * (greatest(0,p_count)::numeric*2/greatest(1,least(5,p_parallel))+60)))
$$;
REVOKE ALL ON FUNCTION public.deep_find_check_deadline(timestamptz,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deep_find_check_deadline(timestamptz,integer,integer) TO service_role;
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
        AND now()<q.created_at+interval '60 minutes' AND now()<public.deep_find_check_deadline(r.started_at,r.lead_count,r.deep_find_parallel)
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
      AND now()<q.created_at+interval '60 minutes' AND now()<public.deep_find_check_deadline(r.started_at,r.lead_count,r.deep_find_parallel) AND r.status<>'cancelled';
  GET DIAGNOSTICS recovered = ROW_COUNT;
  UPDATE public.deep_find_check_queue q SET status='skipped',reason='run_time_limit',finished_at=now()
    FROM public.deep_find_runs r WHERE r.id=q.run_id
      AND (q.status='queued' OR (q.status='running' AND (q.claimed_at<now()-interval '5 minutes' OR r.status='cancelled')))
      AND (q.created_at<=now()-interval '60 minutes' OR public.deep_find_check_deadline(r.started_at,r.lead_count,r.deep_find_parallel)<=now() OR r.status='cancelled');
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

ALTER TABLE public.deep_find_runs ADD COLUMN gemini_refused_status integer CHECK (gemini_refused_status IN (401,402,403));
CREATE OR REPLACE FUNCTION public.gemini_run_status(p_run uuid,p_status integer DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 IF p_status IS NOT NULL AND p_status NOT IN (401,402,403) THEN RAISE EXCEPTION 'Invalid refusal'; END IF;
 IF p_status IS NOT NULL THEN
  UPDATE public.deep_find_runs SET gemini_refused_status=coalesce(gemini_refused_status,p_status)
  WHERE id=p_run RETURNING gemini_refused_status INTO result;
 ELSE SELECT gemini_refused_status INTO result FROM public.deep_find_runs WHERE id=p_run; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.gemini_run_status(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gemini_run_status(uuid,integer) TO service_role;

-- Match the Kevin-approved production values; do not change Firecrawl or Places quotas.
UPDATE public.usage_resources SET default_org_limit=400,global_limit=1600 WHERE resource='worker_scrape';
