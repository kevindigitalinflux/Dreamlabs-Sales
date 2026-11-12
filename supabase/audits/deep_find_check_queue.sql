-- LOCAL-ONLY FIXTURE AUDIT. Never execute against production or a database with active queue/cron work.
-- Requires migration 075 reviewed and installed in a disposable database, with its guard removed there only.
-- Every fixture/write below is inside one DO statement and rolled back by the mandatory final exception.
-- This file was written, not executed. Real concurrent lock contention requires two separate local sessions.
DO $$
DECLARE
  owner_id uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  org_a uuid; org_b uuid; visible_pipeline uuid; hidden_pipeline uuid; other_pipeline uuid;
  visible_lead uuid; hidden_lead uuid; other_lead uuid; run_a uuid; run_b uuid;
  visible_row uuid; hidden_row uuid; other_row uuid; row_id uuid; n integer; distinct_domains integer; rows_json jsonb;
  function_signature text; user_role text;
  pair record; wrong_tier text; invalid_patch jsonb; snapshot jsonb; fixture public.email_logs%rowtype;
BEGIN
  IF EXISTS (SELECT 1 FROM public.deep_find_check_queue) THEN RAISE EXCEPTION 'Audit requires an empty disposable queue'; END IF;
  INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
    email_change_token_new,email_change_token_current,email_change,phone_change,phone_change_token,reauthentication_token)
    SELECT '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',u.email,'',now(),
      '{}','{}',now(),now(),'','','','','','','',''
    FROM (VALUES(owner_id,'queue-owner@fixture.test'),(member_id,'queue-member@fixture.test'),(outsider_id,'queue-outsider@fixture.test')) u(id,email);
  INSERT INTO public.organizations(name,created_by) VALUES('Verifier queue audit A',owner_id) RETURNING id INTO org_a;
  INSERT INTO public.organizations(name,created_by) VALUES('Verifier queue audit B',outsider_id) RETURNING id INTO org_b;
  INSERT INTO public.org_members(org_id,user_id,role) VALUES(org_a,owner_id,'admin'),(org_a,member_id,'contractor'),(org_b,outsider_id,'admin');
  INSERT INTO public.pipelines(org_id,name,is_default,created_by) VALUES(org_a,'Visible audit pipeline',false,owner_id) RETURNING id INTO visible_pipeline;
  INSERT INTO public.pipelines(org_id,name,is_default,created_by) VALUES(org_a,'Hidden audit pipeline',false,owner_id) RETURNING id INTO hidden_pipeline;
  INSERT INTO public.pipelines(org_id,name,is_default,created_by) VALUES(org_b,'Other audit pipeline',false,outsider_id) RETURNING id INTO other_pipeline;
  INSERT INTO public.pipeline_shares(pipeline_id,shared_with_user_id,permission,shared_by) VALUES(visible_pipeline,member_id,'view',owner_id);
  INSERT INTO public.leads(org_id,pipeline_id,business_name,created_by) VALUES(org_a,visible_pipeline,'Queue visible fixture',owner_id) RETURNING id INTO visible_lead;
  INSERT INTO public.leads(org_id,pipeline_id,business_name,created_by) VALUES(org_a,hidden_pipeline,'Queue hidden fixture',owner_id) RETURNING id INTO hidden_lead;
  INSERT INTO public.leads(org_id,pipeline_id,business_name,created_by) VALUES(org_b,other_pipeline,'Queue other fixture',outsider_id) RETURNING id INTO other_lead;
  INSERT INTO public.deep_find_runs(org_id,created_by,lead_count) VALUES(org_a,owner_id,2) RETURNING id INTO run_a;
  INSERT INTO public.deep_find_runs(org_id,created_by,lead_count) VALUES(org_b,outsider_id,1) RETURNING id INTO run_b;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    VALUES(org_a,run_a,visible_lead,'visible@fixture.test','fixture.test','smtp') RETURNING id INTO visible_row;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    VALUES(org_a,run_a,hidden_lead,'hidden@fixture.test','fixture.test','smtp') RETURNING id INTO hidden_row;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    VALUES(org_b,run_b,other_lead,'other@fixture.test','fixture.test','smtp') RETURNING id INTO other_row;

  -- Catalog checks: table grants and all RPC execution grants, including PUBLIC inheritance.
  FOREACH user_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(user_role,'public.deep_find_check_queue','INSERT')
      OR has_table_privilege(user_role,'public.deep_find_check_queue','UPDATE')
      OR has_table_privilege(user_role,'public.deep_find_check_queue','DELETE') THEN RAISE EXCEPTION 'Client queue write grant'; END IF;
    FOREACH function_signature IN ARRAY ARRAY[
      'public.deep_find_checks_enqueue(jsonb)','public.deep_find_checks_claim(integer)',
      'public.deep_find_checks_finish(uuid,text,text,text,text,timestamptz)','public.deep_find_checks_expire()'] LOOP
      IF has_function_privilege(user_role,function_signature,'EXECUTE') THEN RAISE EXCEPTION 'Client RPC execute grant'; END IF;
      IF NOT has_function_privilege('service_role',function_signature,'EXECUTE') THEN RAISE EXCEPTION 'Service RPC execute missing'; END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',member_id,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.deep_find_check_queue WHERE id=visible_row;
  IF n<>1 THEN RAISE EXCEPTION 'Visible member read failed'; END IF;
  SELECT count(*) INTO n FROM public.deep_find_check_queue WHERE id IN(hidden_row,other_row);
  IF n<>0 THEN RAISE EXCEPTION 'Hidden lead or foreign org leaked'; END IF;
  BEGIN
    INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind) VALUES(org_a,run_a,visible_lead,'write@fixture.test','fixture.test','smtp');
    RAISE EXCEPTION 'Client insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.deep_find_check_queue SET status='done' WHERE id=visible_row; RAISE EXCEPTION 'Client update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.deep_find_check_queue WHERE id=visible_row; RAISE EXCEPTION 'Client delete allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN SELECT count(*) INTO n FROM public.deep_find_check_queue;
    IF n<>0 THEN RAISE EXCEPTION 'Anon queue read leaked'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);

  -- R9 accepted pairs: LOCAL-ONLY send-log fixtures, derived directly from 074 plus the four approved bases.
  FOR pair IN SELECT * FROM (VALUES
    ('T1','checker_valid'),('T1','replied'),('T1','sent_ok'),('T1','company_site'),('T1','places'),('T1','saved_non_guessed'),
    ('T2','supported_pattern'),('T3','evidence_mismatch'),('T3','role_review'),('T3','pattern_paused'),('T3','weak_evidence'),
    ('T1','ms_exists'),('T1','role_confirmed'),('T3','ms_not_found'),('T3','saved_unproven')
  ) accepted(tier,basis) LOOP
    INSERT INTO public.email_logs(org_id,lead_id,sent_by,to_email,subject,body,status,sent_at,
      recipient_tier_at_send,recipient_tier_basis,recipient_tier_version,recipient_was_sent_ok,recipient_tier_recorded_at)
    VALUES(org_a,visible_lead,owner_id,'snapshot@fixture.test','Local snapshot audit','Fixture only','sent',now(),
      pair.tier,pair.basis,1,pair.basis='sent_ok',now());
  END LOOP;

  -- R9 wrong tiers: every new basis must fail with BOTH other tiers, not just one representative.
  FOR pair IN SELECT * FROM (VALUES ('T1','ms_exists'),('T1','role_confirmed'),('T3','ms_not_found'),('T3','saved_unproven')) accepted(tier,basis) LOOP
    FOREACH wrong_tier IN ARRAY ARRAY['T1','T2','T3'] LOOP
      IF wrong_tier=pair.tier THEN CONTINUE; END IF;
      BEGIN
        INSERT INTO public.email_logs(org_id,lead_id,sent_by,to_email,subject,body,status,sent_at,
          recipient_tier_at_send,recipient_tier_basis,recipient_tier_version,recipient_was_sent_ok,recipient_tier_recorded_at)
        VALUES(org_a,visible_lead,owner_id,'snapshot@fixture.test','Local wrong-tier audit','Fixture only','sent',now(),
          wrong_tier,pair.basis,1,false,now());
        RAISE EXCEPTION 'New basis accepted wrong tier: % / %',wrong_tier,pair.basis;
      EXCEPTION WHEN check_violation THEN NULL; END;
    END LOOP;
  END LOOP;

  -- R9 snapshot invariants: NULL history stays valid; each independent malformed shape must fail.
  INSERT INTO public.email_logs(org_id,lead_id,sent_by,to_email,subject,body,status,sent_at)
    VALUES(org_a,visible_lead,owner_id,'legacy@fixture.test','Local null snapshot audit','Fixture only','sent',now());
  snapshot := jsonb_build_object('status','sent','sent_at',now(),'recipient_tier_at_send','T1',
    'recipient_tier_basis','checker_valid','recipient_tier_version',1,'recipient_was_sent_ok',false,'recipient_tier_recorded_at',now());
  FOR invalid_patch IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('recipient_tier_basis',NULL),
    jsonb_build_object('status','draft'),
    jsonb_build_object('recipient_tier_version',2),
    jsonb_build_object('recipient_tier_at_send','T2','recipient_tier_basis','supported_pattern','recipient_was_sent_ok',true),
    jsonb_build_object('recipient_tier_basis','sent_ok','recipient_was_sent_ok',false),
    jsonb_build_object('recipient_tier_recorded_at',now()-interval '1 second'),
    jsonb_build_object('recipient_tier_basis','unknown_basis')
  )) LOOP
    fixture := jsonb_populate_record(NULL::public.email_logs,snapshot||invalid_patch);
    BEGIN
      INSERT INTO public.email_logs(org_id,lead_id,sent_by,to_email,subject,body,status,sent_at,
        recipient_tier_at_send,recipient_tier_basis,recipient_tier_version,recipient_was_sent_ok,recipient_tier_recorded_at)
      VALUES(org_a,visible_lead,owner_id,'snapshot@fixture.test','Local shape audit','Fixture only',fixture.status,fixture.sent_at,
        fixture.recipient_tier_at_send,fixture.recipient_tier_basis,fixture.recipient_tier_version,fixture.recipient_was_sent_ok,fixture.recipient_tier_recorded_at);
      RAISE EXCEPTION 'Malformed snapshot accepted: %',invalid_patch;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;

  -- Enqueue cap and duplicate addressing are durable, not a per-invocation counter.
  DELETE FROM public.deep_find_check_queue WHERE org_id IN(org_a,org_b);
  SELECT jsonb_agg(jsonb_build_object('org_id',org_a,'run_id',run_a,'lead_id',visible_lead,
    'address','person'||i||'@cap.fixture.test','domain','cap.fixture.test','kind','smtp')) INTO rows_json FROM generate_series(1,35) i;
  n := public.deep_find_checks_enqueue(rows_json);
  IF n<>30 OR public.deep_find_checks_enqueue(rows_json)<>0 THEN RAISE EXCEPTION 'Thirty-row cap/deduplication failed'; END IF;
  SELECT id INTO row_id FROM public.deep_find_check_queue WHERE lead_id=visible_lead LIMIT 1;
  IF public.deep_find_checks_finish(row_id,'done','valid','deliverable','unknown',NULL) THEN RAISE EXCEPTION 'Finish changed a queued row'; END IF;

  -- One domain per claim call and four recent starts per domain across calls/runs.
  DELETE FROM public.deep_find_check_queue WHERE org_id=org_a;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    SELECT org_a,run_a,visible_lead,'a'||i||'@a.fixture.test','a.fixture.test','smtp' FROM generate_series(1,6) i;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    VALUES(org_a,run_a,visible_lead,'b@b.fixture.test','b.fixture.test','smtp');
  SELECT count(*),count(DISTINCT domain) INTO n,distinct_domains FROM public.deep_find_checks_claim(10);
  IF n<>2 OR distinct_domains<>2 THEN RAISE EXCEPTION 'One-domain claim rule failed'; END IF;
  UPDATE public.deep_find_check_queue SET status='done' WHERE status='running';
  UPDATE public.deep_find_check_queue SET claimed_at=now(),status='done'
    WHERE id IN(SELECT id FROM public.deep_find_check_queue WHERE domain='a.fixture.test' ORDER BY id LIMIT 4);
  SELECT count(*) INTO n FROM public.deep_find_checks_claim(10);
  IF n<>0 THEN RAISE EXCEPTION 'Four-per-minute pacing failed'; END IF;
  UPDATE public.deep_find_check_queue SET claimed_at=now()-interval '61 seconds';
  SELECT count(*) INTO n FROM public.deep_find_checks_claim(10);
  IF n<>1 THEN RAISE EXCEPTION 'Pacing did not release after sixty seconds'; END IF;
  SELECT id INTO row_id FROM public.deep_find_check_queue WHERE status='running' LIMIT 1;
  IF NOT public.deep_find_checks_finish(row_id,'queued',NULL,'timeout','unknown',now()+interval '90 seconds')
    THEN RAISE EXCEPTION 'Running retry finish failed'; END IF;
  IF public.deep_find_checks_finish(row_id,'done','valid','deliverable','unknown',NULL) THEN RAISE EXCEPTION 'Finish was not running-only'; END IF;

  -- Expiry, cancellation, completed-run hour window and same-person sibling cleanup.
  DELETE FROM public.deep_find_check_queue WHERE org_id=org_a;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind,person_key,status,verdict)
    VALUES(org_a,run_a,visible_lead,'proved@a.fixture.test','a.fixture.test','smtp','person','done','valid'),
      (org_a,run_a,visible_lead,'sibling@b.fixture.test','b.fixture.test','smtp','person','queued',NULL);
  -- R4 same person across leads: a normalized key is only unique within its own lead.
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind,person_key)
    VALUES(org_a,run_a,hidden_lead,'same-person@b.fixture.test','b.fixture.test','smtp','person');
  PERFORM public.deep_find_checks_expire();
  IF NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE reason='person_done') THEN RAISE EXCEPTION 'Sibling cleanup failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE lead_id=hidden_lead AND person_key='person' AND status='queued')
    THEN RAISE EXCEPTION 'Same person key skipped a different lead'; END IF;
  DELETE FROM public.deep_find_check_queue WHERE org_id=org_a;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    VALUES(org_a,run_a,visible_lead,'window@c.fixture.test','c.fixture.test','smtp');
  UPDATE public.deep_find_runs SET status='completed',finished_at=now(),started_at=now()-interval '61 minutes' WHERE id=run_a;
  SELECT count(*) INTO n FROM public.deep_find_checks_claim(10);
  IF n<>0 THEN RAISE EXCEPTION 'Completed run escaped hour window'; END IF;
  PERFORM public.deep_find_checks_expire();
  IF NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE reason='run_time_limit') THEN RAISE EXCEPTION 'Run expiry failed'; END IF;
  UPDATE public.deep_find_runs SET status='active',started_at=now(),finished_at=NULL WHERE id=run_a;
  -- R5 stale running recovery: active-window work is retried, preserving attempts; recent claims remain running.
  UPDATE public.deep_find_check_queue SET status='running',claimed_at=now()-interval '6 minutes',attempts=2,next_at=now()+interval '15 minutes',reason=NULL;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind,status,claimed_at,attempts)
    VALUES(org_a,run_a,visible_lead,'recent@c.fixture.test','c.fixture.test','smtp','running',now()-interval '2 minutes',1);
  PERFORM public.deep_find_checks_expire();
  IF NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE address='window@c.fixture.test' AND status='queued' AND attempts=2 AND next_at=now())
    THEN RAISE EXCEPTION 'Stale active claim did not recover without spending an attempt'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE address='recent@c.fixture.test' AND status='running' AND attempts=1)
    THEN RAISE EXCEPTION 'Recent claim recovered prematurely'; END IF;
  UPDATE public.deep_find_check_queue SET status='running',claimed_at=now()-interval '6 minutes',reason=NULL;
  UPDATE public.deep_find_runs SET status='cancelled' WHERE id=run_a;
  PERFORM public.deep_find_checks_expire();
  IF EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE status='running') THEN RAISE EXCEPTION 'Cancelled stale claim not skipped'; END IF;

  -- Cascade checks stay inside these throwaway fixture IDs.
  DELETE FROM public.leads WHERE id=visible_lead;
  IF EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE lead_id=visible_lead) THEN RAISE EXCEPTION 'Lead cascade failed'; END IF;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    VALUES(org_a,run_a,hidden_lead,'run-cascade@fixture.test','fixture.test','smtp');
  DELETE FROM public.deep_find_runs WHERE id=run_a;
  IF EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE run_id=run_a) THEN RAISE EXCEPTION 'Run cascade failed'; END IF;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    VALUES(org_b,run_b,other_lead,'org-cascade@fixture.test','fixture.test','smtp');
  DELETE FROM public.organizations WHERE id=org_b;
  IF EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE org_id=org_b) THEN RAISE EXCEPTION 'Org cascade failed'; END IF;
  RAISE EXCEPTION 'VERIFIER_V2_QUEUE_AUDIT_ROLLBACK: all fixture checks passed; nothing persisted';
END $$;
