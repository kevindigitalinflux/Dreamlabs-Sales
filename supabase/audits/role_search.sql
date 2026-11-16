-- LOCAL DISPOSABLE DATABASE ONLY, after reviewed migration 077. Written, not executed.
DO $$
DECLARE
 owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
 org_a uuid; org_b uuid; visible_pipeline uuid; hidden_pipeline uuid; other_pipeline uuid;
 visible_lead uuid; hidden_lead uuid; other_lead uuid; run_a uuid; run_b uuid;
 profile_id uuid; contact_id uuid; changed integer; role_values text[]; answer jsonb; client_role text; today date:=(now() AT TIME ZONE 'Europe/London')::date;
BEGIN
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
 INSERT INTO public.usage_counters(org_id,resource,day,used) VALUES(org_a,'worker_search',today,399);
 INSERT INTO public.usage_global_counters(resource,day,used) VALUES('worker_search',today,399) ON CONFLICT(resource,day) DO UPDATE SET used=399;
 answer:=public.usage_reserve(org_a,'worker_search',1);
 IF answer->>'ok'<>'true' OR (answer->>'used')::integer<>400 THEN RAISE EXCEPTION '400th search refused'; END IF;
 answer:=public.usage_reserve(org_a,'worker_search',1);
 IF answer->>'ok'<>'false' OR answer->>'reason'<>'org_limit' THEN RAISE EXCEPTION '401st search allowed'; END IF;
 UPDATE public.usage_global_counters SET used=1199 WHERE resource='worker_search' AND day=today;
 answer:=public.usage_reserve(org_b,'worker_search',1);
 IF answer->>'ok'<>'true' OR (answer->>'global_used')::integer<>1200 THEN RAISE EXCEPTION '1200th shared search refused'; END IF;
 answer:=public.usage_reserve(org_b,'worker_search',1);
 IF answer->>'ok'<>'false' OR answer->>'reason'<>'shared_pool' THEN RAISE EXCEPTION '1201st shared search allowed'; END IF;
 FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  PERFORM set_config('request.jwt.claims',json_build_object('sub',member_id,'role',client_role)::text,true);
  EXECUTE format('SET LOCAL ROLE %I',client_role);
  BEGIN UPDATE public.usage_counters SET used=0 WHERE org_id=org_a; RAISE EXCEPTION 'Client wrote org counter'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.usage_global_counters SET used=0; RAISE EXCEPTION 'Client wrote global counter'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
 END LOOP;

 -- Task 4 profile and provider-source contract. No policy/grant changes.
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO public.ideal_customer_profiles(org_id,name,created_by) VALUES(org_a,'Role audit',owner_id) RETURNING id INTO profile_id;
 SELECT array_agg('Role '||n) INTO role_values FROM generate_series(1,13) n;
 BEGIN UPDATE public.ideal_customer_profiles SET target_roles=role_values WHERE id=profile_id; RAISE EXCEPTION '13 target roles accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.ideal_customer_profiles SET fallback_roles=ARRAY[repeat('x',61)] WHERE id=profile_id; RAISE EXCEPTION '61-character fallback accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.ideal_customer_profiles SET target_roles=ARRAY[NULL::text] WHERE id=profile_id; RAISE EXCEPTION 'Null role accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.decision_maker_candidates(lead_id,source,first_name,last_name,title,created_by)
 VALUES(visible_lead,'role_search','Jane','Doe','Facilities Manager',owner_id) RETURNING id INTO contact_id;
 IF NOT EXISTS(SELECT 1 FROM public.decision_maker_candidates WHERE id=contact_id AND include_in_sequences=false) THEN RAISE EXCEPTION 'Provider default enrolled'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',member_id,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.ideal_customer_profiles SET target_roles=ARRAY['Director'] WHERE id=profile_id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'Member edited roles'; END IF;
 BEGIN INSERT INTO public.decision_maker_candidates(lead_id,source,first_name,last_name,created_by)
 VALUES(visible_lead,'role_search','Other','Person',member_id); RAISE EXCEPTION 'Client inserted role-search contact'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 -- Privileged execution with a client auth.uid tests the generic trigger independently of column grants.
 BEGIN UPDATE public.decision_maker_candidates SET source='manual' WHERE id=contact_id; RAISE EXCEPTION 'Provider guard allowed source edit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.ideal_customer_profiles SET target_roles=ARRAY['Facilities Manager'],fallback_roles=ARRAY['Office Manager'] WHERE id=profile_id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Admin role save refused'; END IF;
 RESET ROLE;
 RAISE EXCEPTION 'AUDIT PASSED; rollback all fixtures';
END $$;
