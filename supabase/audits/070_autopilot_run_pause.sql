-- REVIEW ONLY. Neither block was executed by the builder.
-- PRODUCTION-SAFE READ-ONLY ASSERTIONS ONLY. No fixture or auth writes.
DO $$
DECLARE definition text;
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.autopilot_runs'::regclass), 'runs RLS enabled';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.autopilot_run_leads'::regclass), 'queue RLS enabled';
  SELECT pg_get_indexdef('public.autopilot_runs_one_active_per_org_mode'::regclass) INTO definition;
  ASSERT definition LIKE '%active%' AND definition LIKE '%paused%', 'one live run index covers pause';
  ASSERT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.autopilot_runs'::regclass
    AND conname='autopilot_runs_status_check' AND pg_get_constraintdef(oid) LIKE '%paused%'), 'paused is permitted';
  ASSERT NOT has_table_privilege('authenticated','public.autopilot_runs','UPDATE'), 'no table-wide UPDATE';
  ASSERT has_column_privilege('authenticated','public.autopilot_runs','status','UPDATE'), 'status grant preserved';
  ASSERT has_column_privilege('authenticated','public.autopilot_runs','cancel_reason','UPDATE'), 'reason grant preserved';
  ASSERT NOT has_column_privilege('authenticated','public.autopilot_runs','paused_at','UPDATE'), 'pause time protected';
  ASSERT NOT has_column_privilege('authenticated','public.autopilot_runs','resumed_at','UPDATE'), 'resume time protected';
  ASSERT NOT has_table_privilege('authenticated','public.autopilot_run_leads','UPDATE'), 'queue engine-only';
  ASSERT has_function_privilege('authenticated','public.autopilot_control_run(uuid,text)','EXECUTE'), 'authenticated control';
  ASSERT NOT has_function_privilege('anon','public.autopilot_control_run(uuid,text)','EXECUTE'), 'anonymous denied';
  ASSERT NOT has_function_privilege('authenticated','public.autopilot_claim_lead(uuid)','EXECUTE'), 'claim engine-only';
  ASSERT NOT has_function_privilege('authenticated','public.autopilot_finish_selected(uuid,text,text)','EXECUTE'), 'finish engine-only';
  ASSERT NOT has_function_privilege('authenticated','public.autopilot_reserve_send(uuid)','EXECUTE'), 'reserve engine-only';
  ASSERT EXISTS (SELECT FROM pg_proc WHERE oid='public.autopilot_claim_lead(uuid)'::regprocedure
    AND prosecdef AND proconfig @> ARRAY['search_path=""']), 'claim fixed search path';
  RAISE EXCEPTION 'PASS 070 read-only assertions. ROLLED BACK.';
END $$;

-- DISPOSABLE LOCAL DATABASE ONLY. Never run this fixture block on production.
-- A two-session concurrency exercise is additionally required before rollout: hold a run
-- UPDATE lock in session A, invoke claim/reserve in B, commit Pause in A; both B calls
-- must return empty/false. Reverse order: one claim/reservation can win, never a second
-- working lead. These assertions below are sequential and do not replace that exercise.
DO $$
DECLARE actor uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); org uuid;
  lead1 uuid; lead2 uuid; run1 uuid; run2 uuid; n integer;
BEGIN
  INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
    email_change_token_new,email_change_token_current,email_change,phone_change,phone_change_token,reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',u::text||'@example.invalid','',now(),
    '{}','{}',now(),now(),'','','','','','','','' FROM unnest(ARRAY[actor,outsider]) u;
  INSERT INTO public.organizations(name) VALUES('070 disposable pause fixture') RETURNING id INTO org;
  INSERT INTO public.org_members(org_id,user_id,role) VALUES(org,actor,'contractor'),(org,outsider,'contractor');
  INSERT INTO public.leads(org_id,business_name,created_by) VALUES(org,'070 first',actor) RETURNING id INTO lead1;
  INSERT INTO public.leads(org_id,business_name,created_by) VALUES(org,'070 second',actor) RETURNING id INTO lead2;
  INSERT INTO public.autopilot_runs(org_id,created_by,mode,daily_send_cap) VALUES(org,actor,'selected',2) RETURNING id INTO run1;
  INSERT INTO public.autopilot_run_leads(run_id,org_id,lead_id) VALUES(run1,org,lead1),(run1,org,lead2);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.autopilot_control_run(run1,'pause');
    RAISE EXCEPTION 'unauthorised control succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'unauthorised control succeeded' THEN RAISE; END IF;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.autopilot_control_run(run1,'pause');
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT count(*)=0 FROM public.autopilot_claim_lead(run1)), 'pause before claim blocks claim';
  ASSERT NOT public.autopilot_reserve_send(run1), 'pause blocks reserve';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.autopilot_control_run(run1,'resume');
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.autopilot_claim_lead(run1); ASSERT n=1, 'one claim';
  ASSERT (SELECT count(*)=0 FROM public.autopilot_claim_lead(run1)), 'second worker blocked';
  ASSERT public.autopilot_reserve_send(run1), 'active reservation succeeds';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.autopilot_control_run(run1,'pause');
  EXECUTE 'RESET ROLE';
  ASSERT NOT public.autopilot_reserve_send(run1), 'stale worker cannot reserve after pause';
  UPDATE public.autopilot_run_leads SET status='sent' WHERE run_id=run1 AND status='working';
  ASSERT (SELECT outreach_sent_total=1 FROM public.autopilot_runs WHERE id=run1), 'reserved counter retained';
  ASSERT (SELECT count(*)=1 FROM public.autopilot_run_leads WHERE run_id=run1 AND status='queued'), 'queue retained';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.autopilot_control_run(run1,'stop');
  EXECUTE 'RESET ROLE';
  INSERT INTO public.autopilot_runs(org_id,created_by,mode) VALUES(org,actor,'selected') RETURNING id INTO run2;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.autopilot_control_run(run1,'resume');
    RAISE EXCEPTION 'duplicate live run succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Another live run already exists%' THEN RAISE; END IF;
  END;
  EXECUTE 'RESET ROLE';
  DELETE FROM public.autopilot_runs WHERE id=run2;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.autopilot_control_run(run1,'resume');
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT outreach_sent_total=1 AND daily_send_cap=2 AND resumed_at IS NOT NULL FROM public.autopilot_runs WHERE id=run1), 'resume preserves counters and cap';
  RAISE EXCEPTION 'PASS 070 local fixtures. ROLLED BACK.';
END $$;
