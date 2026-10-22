-- Kevin runs after reviewed migration 066. Never remove the final exception.
-- One DO block: all fixtures and mutations roll back; no customer values printed.
DO $$
DECLARE
  report text := '';
  owner_user uuid; owner_org uuid; other_org uuid; second_org uuid;
  client_admin uuid := gen_random_uuid(); plain_member uuid := gen_random_uuid();
  unknown_user uuid := gen_random_uuid();
BEGIN
  ASSERT EXISTS (SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'grants_platform_owner' AND data_type = 'boolean'
      AND is_nullable = 'NO' AND column_default = 'false'), 'boolean column defaults false';
  ASSERT (SELECT count(*) = 2 FROM public.organizations WHERE grants_platform_owner), 'exactly two owner orgs';
  ASSERT (SELECT count(DISTINCT name) = 2 FROM public.organizations
    WHERE grants_platform_owner AND name IN ('Mr Brush & Co', 'DI Dreamlabs')), 'expected owner org names';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organizations'::regclass), 'organizations RLS enabled';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.org_members'::regclass), 'org_members RLS enabled';
  ASSERT NOT has_function_privilege('anon', 'public.is_platform_owner(uuid)', 'EXECUTE'), 'anon cannot execute';
  ASSERT NOT has_function_privilege('authenticated', 'public.is_platform_owner(uuid)', 'EXECUTE'), 'authenticated cannot execute';
  ASSERT has_function_privilege('service_role', 'public.is_platform_owner(uuid)', 'EXECUTE'), 'service role can execute';
  ASSERT NOT has_table_privilege('authenticated', 'public.organizations', 'UPDATE'), 'no table-wide update';
  ASSERT NOT has_column_privilege('authenticated', 'public.organizations', 'grants_platform_owner', 'UPDATE'), 'owner flag is locked';
  SELECT m.user_id, m.org_id INTO owner_user, owner_org
    FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
    WHERE m.role = 'admin' AND o.grants_platform_owner LIMIT 1;
  ASSERT owner_user IS NOT NULL, 'requires an existing owner admin';
  ASSERT public.is_platform_owner(owner_user), 'existing flagged admin is owner';
  ASSERT NOT public.is_platform_owner(unknown_user), 'unknown user is not owner';
  report := report || E'\nPASS schema, owner flags, RLS, grants and real owner';

  INSERT INTO auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.id::text || '@example.invalid', '', now(),
    '{}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  FROM (VALUES (client_admin), (plain_member)) u(id);
  INSERT INTO public.organizations(name) VALUES ('066 rollback audit one') RETURNING id INTO other_org;
  INSERT INTO public.organizations(name) VALUES ('066 rollback audit two') RETURNING id INTO second_org;
  ASSERT (SELECT NOT grants_platform_owner FROM public.organizations WHERE id = other_org), 'new org defaults false';
  INSERT INTO public.org_members(org_id, user_id, role) VALUES
    (other_org, client_admin, 'admin'), (second_org, plain_member, 'admin'), (owner_org, plain_member, 'team_member');
  ASSERT NOT public.is_platform_owner(client_admin), 'unflagged org admin is not owner';
  ASSERT NOT public.is_platform_owner(plain_member), 'plain owner-org member is not owner';
  UPDATE public.org_members SET role = 'admin' WHERE org_id = owner_org AND user_id = plain_member;
  ASSERT public.is_platform_owner(plain_member), 'ownership gained on promotion';
  UPDATE public.org_members SET role = 'team_member' WHERE org_id = owner_org AND user_id = plain_member;
  ASSERT NOT public.is_platform_owner(plain_member), 'ownership lost on demotion';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', client_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.organizations SET grants_platform_owner = true WHERE id = other_org;
    RAISE EXCEPTION 'authenticated owner flag update accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{}', true);
  report := report || E'\nPASS client admin, plain member, ownership transitions and authenticated update denial';
  RAISE EXCEPTION 'PLATFORM_OWNER_AUDIT (all writes rolled back)\n%', report;
END $$;
