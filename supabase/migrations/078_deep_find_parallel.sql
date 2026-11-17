-- Local draft only. Review and rolled-back fixture audit before applying.
BEGIN;
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
COMMIT;
