-- 059_usage_quotas.sql
-- Usage limits for the shared lookup worker (docs/superpowers/specs/2026-10-14-usage-quotas-design.md).
--
-- SECURITY NOTES
-- * usage_reserve / usage_refund are SECURITY DEFINER, search_path = '', granted to service_role ONLY (the edge
--   functions call them). The browser can never move a counter.
-- * usage_reserve locks the worker-wide row FIRST and the organisation row second, in one transaction, so concurrent
--   calls serialise and can never overshoot either cap, and two callers can never deadlock.
-- * usage_snapshot is SECURITY DEFINER but starts with an is_org_member check (42501 when not a member).
-- * Organisation admins may edit THEIR OWN limits (0 to 5000) through RLS; the worker-wide cap always wins because
--   usage_reserve checks both. updated_by / updated_at are stamped by a trigger, not by the client.
-- * Days are London days: day = (now() AT TIME ZONE 'Europe/London')::date.
-- No existing table, policy or grant is changed.

-- 1. Tables ---------------------------------------------------------------------------
CREATE TABLE public.usage_resources (
  resource TEXT PRIMARY KEY CHECK (resource IN ('worker_scrape', 'worker_verify', 'worker_fetch')),
  label TEXT NOT NULL,
  default_org_limit INT NOT NULL CHECK (default_org_limit BETWEEN 0 AND 5000),
  global_limit INT NOT NULL CHECK (global_limit BETWEEN 0 AND 100000)
);
-- Keep in step with USAGE_DEFAULTS in supabase/functions/_shared/usageRules.ts.
INSERT INTO public.usage_resources (resource, label, default_org_limit, global_limit) VALUES
  ('worker_scrape', 'Site scrapes', 100, 400),
  ('worker_verify', 'Email checks', 150, 300),
  ('worker_fetch', 'Page fetches', 300, 1000);

CREATE TABLE public.usage_limits (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource TEXT NOT NULL REFERENCES public.usage_resources(resource),
  daily_limit INT NOT NULL CHECK (daily_limit BETWEEN 0 AND 5000),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, resource)
);

CREATE TABLE public.usage_counters (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource TEXT NOT NULL REFERENCES public.usage_resources(resource),
  day DATE NOT NULL,
  used INT NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (org_id, resource, day)
);

CREATE TABLE public.usage_global_counters (
  resource TEXT NOT NULL REFERENCES public.usage_resources(resource),
  day DATE NOT NULL,
  used INT NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (resource, day)
);

-- 2. RLS and grants ---------------------------------------------------------------------
ALTER TABLE public.usage_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_global_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_resources_select" ON public.usage_resources FOR SELECT TO authenticated USING (true);
CREATE POLICY "usage_limits_select" ON public.usage_limits FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "usage_limits_insert" ON public.usage_limits FOR INSERT WITH CHECK (is_org_admin(org_id));
CREATE POLICY "usage_limits_update" ON public.usage_limits FOR UPDATE USING (is_org_admin(org_id)) WITH CHECK (is_org_admin(org_id));
CREATE POLICY "usage_limits_delete" ON public.usage_limits FOR DELETE USING (is_org_admin(org_id));
CREATE POLICY "usage_counters_select" ON public.usage_counters FOR SELECT USING (is_org_member(org_id));
-- usage_global_counters: no policy at all, so no client can read or write it (usage_snapshot reads it as definer).

REVOKE ALL ON public.usage_resources, public.usage_limits, public.usage_counters, public.usage_global_counters FROM anon, authenticated;
GRANT SELECT ON public.usage_resources TO authenticated;
GRANT SELECT, DELETE ON public.usage_limits TO authenticated;
GRANT INSERT (org_id, resource, daily_limit) ON public.usage_limits TO authenticated;
GRANT UPDATE (daily_limit) ON public.usage_limits TO authenticated;
GRANT SELECT ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_resources, public.usage_limits, public.usage_counters, public.usage_global_counters TO service_role;

-- 3. Stamp who changed a limit ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usage_limits_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER usage_limits_stamp BEFORE INSERT OR UPDATE ON public.usage_limits
  FOR EACH ROW EXECUTE FUNCTION public.usage_limits_stamp();
REVOKE ALL ON FUNCTION public.usage_limits_stamp() FROM PUBLIC, anon, authenticated;

-- 4. Reserve ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usage_reserve(p_org UUID, p_resource TEXT, p_units INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day DATE := (now() AT TIME ZONE 'Europe/London')::date;
  v_res public.usage_resources%ROWTYPE;
  v_org_limit INT;
  v_org_used INT;
  v_g_used INT;
BEGIN
  IF p_units IS NULL OR p_units < 1 OR p_units > 10 OR p_org IS NULL OR p_resource IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  SELECT * INTO v_res FROM public.usage_resources WHERE resource = p_resource;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  SELECT COALESCE((SELECT daily_limit FROM public.usage_limits WHERE org_id = p_org AND resource = p_resource), v_res.default_org_limit)
    INTO v_org_limit;

  INSERT INTO public.usage_global_counters (resource, day, used) VALUES (p_resource, v_day, 0) ON CONFLICT DO NOTHING;
  INSERT INTO public.usage_counters (org_id, resource, day, used) VALUES (p_org, p_resource, v_day, 0) ON CONFLICT DO NOTHING;
  -- Fixed lock order: worker-wide row first, then the organisation row.
  SELECT used INTO v_g_used FROM public.usage_global_counters WHERE resource = p_resource AND day = v_day FOR UPDATE;
  SELECT used INTO v_org_used FROM public.usage_counters WHERE org_id = p_org AND resource = p_resource AND day = v_day FOR UPDATE;

  IF v_org_used + p_units > v_org_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org_limit', 'day', v_day, 'used', v_org_used, 'limit', v_org_limit,
      'global_used', v_g_used, 'global_limit', v_res.global_limit);
  END IF;
  IF v_g_used + p_units > v_res.global_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'shared_pool', 'day', v_day, 'used', v_org_used, 'limit', v_org_limit,
      'global_used', v_g_used, 'global_limit', v_res.global_limit);
  END IF;

  UPDATE public.usage_global_counters SET used = used + p_units WHERE resource = p_resource AND day = v_day;
  UPDATE public.usage_counters SET used = used + p_units WHERE org_id = p_org AND resource = p_resource AND day = v_day;
  RETURN jsonb_build_object('ok', true, 'day', v_day, 'used', v_org_used + p_units, 'limit', v_org_limit,
    'global_used', v_g_used + p_units, 'global_limit', v_res.global_limit);
END;
$$;

-- 5. Refund (only for units this organisation actually used, only for today or yesterday) ----
CREATE OR REPLACE FUNCTION public.usage_refund(p_org UUID, p_resource TEXT, p_units INT, p_day DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Europe/London')::date;
  v_org_used INT;
BEGIN
  IF p_units IS NULL OR p_units < 1 OR p_units > 10 OR p_org IS NULL OR p_resource IS NULL
     OR p_day IS NULL OR p_day > v_today OR p_day < v_today - 1 THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.usage_global_counters WHERE resource = p_resource AND day = p_day FOR UPDATE;
  SELECT used INTO v_org_used FROM public.usage_counters WHERE org_id = p_org AND resource = p_resource AND day = p_day FOR UPDATE;
  IF NOT FOUND OR v_org_used < p_units THEN RETURN false; END IF;
  UPDATE public.usage_counters SET used = used - p_units WHERE org_id = p_org AND resource = p_resource AND day = p_day;
  UPDATE public.usage_global_counters SET used = GREATEST(0, used - p_units) WHERE resource = p_resource AND day = p_day;
  RETURN true;
END;
$$;

-- 6. Snapshot for the meter ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usage_snapshot(p_org UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day DATE := (now() AT TIME ZONE 'Europe/London')::date;
BEGIN
  IF p_org IS NULL OR NOT public.is_org_member(p_org) THEN
    RAISE EXCEPTION 'not a member of this organisation' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'resource', r.resource,
        'used', COALESCE(c.used, 0),
        'limit', COALESCE(l.daily_limit, r.default_org_limit),
        'global_used', COALESCE(g.used, 0),
        'global_limit', r.global_limit,
        'resets_at', ((v_day + 1)::timestamp AT TIME ZONE 'Europe/London')
      ) ORDER BY CASE r.resource WHEN 'worker_scrape' THEN 1 WHEN 'worker_verify' THEN 2 ELSE 3 END)
    FROM public.usage_resources r
    LEFT JOIN public.usage_limits l ON l.org_id = p_org AND l.resource = r.resource
    LEFT JOIN public.usage_counters c ON c.org_id = p_org AND c.resource = r.resource AND c.day = v_day
    LEFT JOIN public.usage_global_counters g ON g.resource = r.resource AND g.day = v_day
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.usage_reserve(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usage_refund(UUID, TEXT, INT, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usage_snapshot(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usage_reserve(UUID, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.usage_refund(UUID, TEXT, INT, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.usage_snapshot(UUID) TO authenticated, service_role;

-- 7. Realtime: the meter refreshes when an organisation's counters change ------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_counters;
