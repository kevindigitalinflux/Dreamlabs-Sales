-- REVIEW ONLY. Neither block was executed by the builder.
-- BLOCK 1: read-only assertions suitable for separately authorized production execution after migration 069.
DO $$
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reply_notifications'::regclass), 'notification RLS';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_replies'::regclass), 'reply RLS';
  ASSERT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_email_settings' AND column_name = 'reply_alerts_after' AND is_nullable = 'NO'), 'release cutoff persists per mailbox';
  ASSERT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'email_replies'
    AND policyname = 'email_replies_visible_only' AND permissive = 'RESTRICTIVE' AND qual LIKE '%can_view_lead%'), 'admin SELECT cannot bypass lead visibility';
  ASSERT has_column_privilege('authenticated','public.reply_notifications','read_at','UPDATE'), 'own read state editable';
  ASSERT NOT has_table_privilege('authenticated','public.reply_notifications','INSERT'), 'clients cannot create alerts';
  ASSERT NOT has_column_privilege('authenticated','public.reply_notifications','user_id','UPDATE'), 'recipient immutable';
  ASSERT NOT has_column_privilege('authenticated','public.reply_notifications','reply_id','UPDATE'), 'reply immutable';
  ASSERT NOT has_table_privilege('anon','public.reply_notifications','SELECT'), 'anon denied';
  ASSERT NOT has_function_privilege('authenticated','public.reply_alert_recipients(uuid)','EXECUTE'), 'service-only recipient lookup';
  ASSERT EXISTS (SELECT FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'email_replies_message_id_unique'), 'message id uniqueness';
  ASSERT EXISTS (SELECT FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'reply_notifications'), 'realtime publication';
  ASSERT NOT EXISTS (SELECT FROM cron.job WHERE jobname = 'check-replies-daily'), 'daily cron removed';
  ASSERT EXISTS (SELECT FROM cron.job WHERE jobname = 'check-replies-tick' AND schedule = '*/5 * * * *'), 'five-minute cron';
  ASSERT EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public.leads'::regclass AND conname = 'leads_stage_check'
    AND pg_get_constraintdef(oid) LIKE '%replied%'), 'replied stage accepted';
  RAISE EXCEPTION 'PASS 069 read-only assertions. No fixtures created. ROLLED BACK.';
END $$;

-- BLOCK 2: DISPOSABLE LOCAL DATABASE ONLY. Never create these throwaway auth users on production.
DO $$
DECLARE sender uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid(); hidden uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid(); org uuid; other_org uuid; pipeline uuid; lead uuid; log uuid; reply uuid; n integer;
BEGIN
  INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
    created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change_token_current,email_change,phone_change,phone_change_token,reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',u.id::text || '@example.invalid','',now(),'{}','{}',now(),now(),'','','','','','','',''
    FROM (VALUES(sender),(admin_id),(hidden),(outsider)) u(id);
  INSERT INTO public.organizations(name) VALUES('069 local audit') RETURNING id INTO org;
  INSERT INTO public.organizations(name) VALUES('069 other') RETURNING id INTO other_org;
  INSERT INTO public.org_members(org_id,user_id,role) VALUES(org,sender,'contractor'),(org,admin_id,'admin'),(org,hidden,'contractor'),(other_org,outsider,'admin');
  INSERT INTO public.pipelines(org_id,name,is_default,created_by) VALUES(org,'069 default',true,admin_id) RETURNING id INTO pipeline;
  INSERT INTO public.leads(org_id,pipeline_id,business_name,created_by,assigned_to,stage) VALUES(org,pipeline,'069 fixture',sender,sender,'replied') RETURNING id INTO lead;
  INSERT INTO public.email_logs(lead_id,org_id,sent_by,to_email,subject,body,status) VALUES(lead,org,sender,'local@example.invalid','Fixture','Fixture','sent') RETURNING id INTO log;
  INSERT INTO public.email_replies(email_log_id,lead_id,org_id,from_email,body,message_id) VALUES(log,lead,org,'local@example.invalid','Fixture','<069@fixture.invalid>') RETURNING id INTO reply;
  ASSERT (SELECT count(*) = 2 FROM public.reply_alert_recipients(reply)), 'sender and admin only';
  INSERT INTO public.reply_notifications(reply_id,org_id,user_id) SELECT reply,org,user_id FROM public.reply_alert_recipients(reply);
  BEGIN
    INSERT INTO public.email_replies(email_log_id,lead_id,org_id,from_email,body,message_id) VALUES(log,lead,org,'local@example.invalid','Fixture','<069@fixture.invalid>');
    RAISE EXCEPTION 'duplicate reply accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',sender,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) = 1 FROM public.reply_notifications WHERE reply_id = reply), 'sender sees own alert only';
  UPDATE public.reply_notifications SET read_at = now() WHERE reply_id = reply;
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'only own read state changes';
  ASSERT public.reply_mark_handled(reply), 'viewer can mark handled';
  BEGIN
    UPDATE public.reply_notifications SET user_id = hidden WHERE reply_id = reply;
    RAISE EXCEPTION 'recipient changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',json_build_object('sub',hidden,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) = 0 FROM public.email_replies WHERE id = reply), 'same-org hidden lead reply denied';
  ASSERT (SELECT count(*) = 0 FROM public.reply_notifications WHERE reply_id = reply), 'nonrecipient denied';
  ASSERT NOT public.reply_mark_handled(reply), 'hidden lead cannot be handled';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) = 0 FROM public.email_replies WHERE id = reply), 'cross-org reply denied';
  ASSERT (SELECT count(*) = 0 FROM public.reply_notifications WHERE reply_id = reply), 'cross-org alert denied';
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'PASS 069 local visibility, grants, handling and uniqueness fixtures. ROLLED BACK.';
END $$;
