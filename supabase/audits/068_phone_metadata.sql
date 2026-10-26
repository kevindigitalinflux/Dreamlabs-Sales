-- REVIEW ONLY. Not executed by the builder. Run after migration 068, with Kevin's approval.
-- One DO block: the final exception rolls back all fixtures and assertions. Never remove it.
DO $$
DECLARE
  editor uuid := gen_random_uuid(); viewer uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  target_org uuid; other_org uuid; pipeline uuid; target uuid; contact uuid;
  n integer; field text; report text := '';
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.leads'::regclass), 'lead RLS stays enabled';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.decision_maker_candidates'::regclass), 'contact RLS stays enabled';
  ASSERT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'decision_maker_candidates'
    AND policyname = 'decision_maker_candidates_update' AND qual LIKE '%can_edit_lead%'), 'existing contact policy';
  ASSERT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'decision_maker_candidates'
    AND policyname = 'decision_maker_candidates_insert' AND with_check LIKE '%auth.uid()%'), 'existing insert scope';
  FOREACH field IN ARRAY ARRAY['phone_kind','phone_source','phone_source_url','phone_found_at'] LOOP
    ASSERT has_column_privilege('authenticated','public.decision_maker_candidates',field,'UPDATE'), 'new metadata editable';
    ASSERT NOT has_column_privilege('anon','public.decision_maker_candidates',field,'UPDATE'), 'anon cannot edit metadata';
  END LOOP;
  FOREACH field IN ARRAY ARRAY['source','apollo_person_id','email_revealed','phone_status','created_by','name_obfuscated','lead_id'] LOOP
    ASSERT NOT has_column_privilege('authenticated','public.decision_maker_candidates',field,'UPDATE'), 'provider column grant remains closed';
  END LOOP;
  ASSERT EXISTS (SELECT FROM pg_trigger WHERE tgrelid = 'public.decision_maker_candidates'::regclass
    AND tgname = 'decision_maker_candidates_guard' AND NOT tgisinternal), 'provider guard remains installed';
  ASSERT has_column_privilege('authenticated','public.leads','phone_meta','UPDATE'), 'lead metadata follows existing table grant';
  ASSERT public.phone_metadata_key('020 7946 0958', 'GB') = '+442079460958', 'GB legacy key';
  ASSERT public.phone_metadata_key('01 234 5678', 'IE') = '+35312345678', 'IE legacy key';
  ASSERT public.phone_metadata_key('(212) 555-0198', 'US') = '+12125550198', 'US legacy key';
  ASSERT public.phone_metadata_key('2023-10-19', 'GB') IS NULL, 'date has no key';
  ASSERT public.phone_metadata_key('02079460958', 'OTHER') IS NULL, 'unlisted region never guessed';

  -- Fresh fixtures, never repurpose a customer's lead. Auth fixture pattern follows audit 064.
  INSERT INTO auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated','authenticated',u.id::text || '@example.invalid','',now(),
    '{}','{}',now(),now(),'','','','','','','',''
  FROM (VALUES(editor),(viewer),(outsider)) u(id);
  INSERT INTO public.organizations(name) VALUES('068 phone audit') RETURNING id INTO target_org;
  INSERT INTO public.organizations(name) VALUES('068 phone audit other') RETURNING id INTO other_org;
  INSERT INTO public.org_members(org_id,user_id,role) VALUES(target_org,editor,'contractor'),(target_org,viewer,'contractor'),(other_org,outsider,'admin');
  INSERT INTO public.pipelines(org_id,name,is_default,created_by) VALUES(target_org,'068 private pipeline',false,editor) RETURNING id INTO pipeline;
  INSERT INTO public.pipeline_shares(pipeline_id,shared_with_user_id,permission,shared_by) VALUES(pipeline,viewer,'view',editor);
  INSERT INTO public.leads(org_id,pipeline_id,business_name,created_by,country,phone,additional_phones)
    VALUES(target_org,pipeline,'068 rollback fixture',editor,'GB','020 7946 0958',ARRAY['+35312345678']) RETURNING id INTO target;
  ASSERT (SELECT phone = '020 7946 0958' AND phone_meta->'+442079460958'->>'kind' = 'unknown'
    AND phone_meta->'+442079460958'->>'source' = 'manual' FROM public.leads WHERE id = target), 'original retained, manual provenance';

  PERFORM set_config('request.jwt.claims',json_build_object('sub',editor,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.decision_maker_candidates(lead_id,source,kind,first_name,last_name,created_by,include_in_sequences,phone,phone_kind,phone_source,phone_source_url,phone_found_at)
    VALUES(target,'manual','person','Phone','Audit',editor,false,'+442079460958','company_line','own_site','https://example.invalid/contact',now()) RETURNING id INTO contact;
  UPDATE public.decision_maker_candidates SET phone_kind = 'direct' WHERE id = contact;
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'editor can save reviewed metadata';
  UPDATE public.leads SET phone_meta = phone_meta || '{"+442079460958":{"kind":"company_line","source":"own_site","source_url":null,"found_at":null}}'::jsonb WHERE id = target;
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'editor can save lead metadata';
  BEGIN
    UPDATE public.decision_maker_candidates SET phone_status = 'revealed' WHERE id = contact;
    RAISE EXCEPTION 'provider column update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.decision_maker_candidates SET phone_kind = 'switchboard_is_direct' WHERE id = contact;
    RAISE EXCEPTION 'invalid phone kind accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.decision_maker_candidates SET phone_source = 'unapproved' WHERE id = contact;
    RAISE EXCEPTION 'invalid phone source accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.decision_maker_candidates SET phone = '+442012345678' WHERE id = contact;
  ASSERT (SELECT phone_kind = 'unknown' AND phone_source = 'manual' AND phone_source_url IS NULL
    AND phone_found_at IS NOT NULL AND NOT include_in_sequences FROM public.decision_maker_candidates WHERE id = contact), 'manual edit resets stale provenance without enrolment';
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims',json_build_object('sub',viewer,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) = 1 FROM public.decision_maker_candidates WHERE id = contact), 'view-only share sees metadata';
  UPDATE public.decision_maker_candidates SET phone_kind = 'direct', phone_source = 'manual' WHERE id = contact;
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'view-only share cannot edit contact metadata';
  UPDATE public.leads SET phone_meta = '{}' WHERE id = target;
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'view-only share cannot edit lead metadata';
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) = 0 FROM public.decision_maker_candidates WHERE id = contact), 'other org cannot read contact metadata';
  ASSERT (SELECT count(*) = 0 FROM public.leads WHERE id = target), 'other org cannot read lead metadata';
  UPDATE public.decision_maker_candidates SET phone_kind = 'direct' WHERE id = contact;
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'other org cannot write metadata';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims','{}',true);
  EXECUTE 'SET LOCAL ROLE anon';
  ASSERT (SELECT count(*) = 0 FROM public.leads WHERE id = target), 'anon cannot read lead metadata';
  ASSERT (SELECT count(*) = 0 FROM public.decision_maker_candidates WHERE id = contact), 'anon cannot read contact metadata';
  EXECUTE 'RESET ROLE';
  report := 'PASS phone metadata constraints, provenance, editor, viewer, cross-org, anon and provider grants. ROLLED BACK.';
  RAISE EXCEPTION '%', report;
END $$;
