-- Apply only after architect review and Kevin's approval. No existing grants or RLS change.
BEGIN;
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS grants_platform_owner boolean NOT NULL DEFAULT false;

DO $$
DECLARE n integer;
BEGIN
  UPDATE public.organizations SET grants_platform_owner = true
    WHERE name IN ('Mr Brush & Co', 'DI Dreamlabs');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected exactly two owner organisations, updated %', n;
  END IF;
  IF (SELECT count(*) FROM public.organizations WHERE grants_platform_owner) <> 2 THEN
    RAISE EXCEPTION 'expected exactly two flagged owner organisations';
  END IF;
  IF (SELECT count(DISTINCT name) FROM public.organizations
      WHERE grants_platform_owner AND name IN ('Mr Brush & Co', 'DI Dreamlabs')) <> 2 THEN
    RAISE EXCEPTION 'expected one owner organisation for each required name';
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.grants_platform_owner IS
  'Admins of this organisation are platform owners. Client roles cannot write this flag.';

CREATE OR REPLACE FUNCTION public.is_platform_owner(p_user uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    JOIN public.organizations o ON o.id = m.org_id
    WHERE m.user_id = p_user AND m.role = 'admin' AND o.grants_platform_owner
  );
$$;
REVOKE ALL ON FUNCTION public.is_platform_owner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_owner(uuid) TO service_role;
COMMIT;
