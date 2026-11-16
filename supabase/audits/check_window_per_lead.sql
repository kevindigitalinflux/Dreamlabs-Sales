-- Local disposable database only, after 075 and 076. Written, not executed.
DO $$
DECLARE
  owner_id uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  org_a uuid; org_b uuid; visible_pipeline uuid; hidden_pipeline uuid; other_pipeline uuid;
  visible_lead uuid; hidden_lead uuid; other_lead uuid; run_a uuid; run_b uuid;
  row_id uuid; n integer; client_role text; signature text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.deep_find_check_queue) THEN RAISE EXCEPTION 'Empty disposable queue required'; END IF;
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

  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  UPDATE public.deep_find_runs SET started_at=now()-interval '70 minutes',status='completed' WHERE id=run_a;
  INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
    VALUES(org_a,run_a,visible_lead,'late@fixture.test','fixture.test','smtp') RETURNING id INTO row_id;
  SELECT count(*) INTO n FROM public.deep_find_checks_claim(1);
  IF n<>1 THEN RAISE EXCEPTION 'Late-enqueued row not claimable'; END IF;
  UPDATE public.deep_find_check_queue SET status='queued',created_at=now()-interval '61 minutes' WHERE id=row_id;
  SELECT count(*) INTO n FROM public.deep_find_checks_claim(1);
  IF n<>0 THEN RAISE EXCEPTION 'Old row was claimed'; END IF;
  PERFORM public.deep_find_checks_expire();
  IF NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE id=row_id AND status='skipped' AND reason='run_time_limit') THEN RAISE EXCEPTION 'Row hour expiry failed'; END IF;
  UPDATE public.deep_find_check_queue SET status='queued',created_at=now(),reason=NULL WHERE id=row_id;
  UPDATE public.deep_find_runs SET started_at=now()-interval '181 minutes' WHERE id=run_a;
  SELECT count(*) INTO n FROM public.deep_find_checks_claim(1);
  IF n<>0 THEN RAISE EXCEPTION 'Three-hour backstop allowed claim'; END IF;
  PERFORM public.deep_find_checks_expire();
  IF NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE id=row_id AND status='skipped' AND reason='run_time_limit') THEN RAISE EXCEPTION 'Run backstop expiry failed'; END IF;
  UPDATE public.deep_find_runs SET started_at=now(),status='cancelled' WHERE id=run_a;
  UPDATE public.deep_find_check_queue SET status='running',created_at=now(),claimed_at=now(),reason=NULL WHERE id=row_id;
  PERFORM public.deep_find_checks_expire();
  IF NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE id=row_id AND status='skipped' AND reason='run_time_limit') THEN RAISE EXCEPTION 'Cancellation did not expire immediately'; END IF;
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH signature IN ARRAY ARRAY['public.deep_find_checks_claim(integer)','public.deep_find_checks_expire()'] LOOP
      IF has_function_privilege(client_role,signature,'EXECUTE') THEN RAISE EXCEPTION 'Client execute grant'; END IF;
      IF NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'Service execute missing'; END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims',json_build_object('role',client_role)::text,true);
    EXECUTE format('SET LOCAL ROLE %I',client_role);
    BEGIN PERFORM public.deep_find_checks_claim(1); RAISE EXCEPTION 'Client claim executed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.deep_find_checks_expire(); RAISE EXCEPTION 'Client expire executed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
  END LOOP;
  RAISE EXCEPTION 'AUDIT PASSED; rollback all fixtures';
END $$;
