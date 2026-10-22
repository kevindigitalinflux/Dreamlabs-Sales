-- 065 is reserved for readiness; 066 belongs to platform owners. Additive only.
-- Search events, Pacific billing months. No existing RLS, key or Vault changes.
CREATE TABLE public.places_usage_limits (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  monthly_limit INT NOT NULL CHECK (monthly_limit BETWEEN 0 AND 100000),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.places_usage_counters (
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  month DATE NOT NULL, used INT NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (org_id, month)
);
CREATE TABLE public.places_shared_limit (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  monthly_limit INT NOT NULL CHECK (monthly_limit BETWEEN 0 AND 100000)
);
INSERT INTO public.places_shared_limit VALUES (true, 900);
CREATE TABLE public.places_shared_counters (
  month DATE PRIMARY KEY, used INT NOT NULL DEFAULT 0 CHECK (used >= 0)
);
-- Reservation provenance makes a refund one-shot and keeps own keys out of the shared pool.
CREATE TABLE public.places_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  month DATE NOT NULL, units INT NOT NULL CHECK (units BETWEEN 1 AND 3),
  shared BOOLEAN NOT NULL, refunded BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE public.places_usage_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places_usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places_shared_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places_shared_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY places_limits_read ON public.places_usage_limits FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY places_limits_insert ON public.places_usage_limits FOR INSERT TO authenticated WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY places_limits_update ON public.places_usage_limits FOR UPDATE TO authenticated USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY places_limits_delete ON public.places_usage_limits FOR DELETE TO authenticated USING (public.is_org_admin(org_id));
CREATE POLICY places_counters_read ON public.places_usage_counters FOR SELECT TO authenticated USING (public.is_org_member(org_id));
REVOKE ALL ON public.places_usage_limits, public.places_usage_counters, public.places_shared_limit, public.places_shared_counters, public.places_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.places_usage_limits TO authenticated;
GRANT INSERT (org_id, monthly_limit) ON public.places_usage_limits TO authenticated;
GRANT UPDATE (monthly_limit) ON public.places_usage_limits TO authenticated;
GRANT SELECT ON public.places_usage_counters TO authenticated;
GRANT ALL ON public.places_usage_limits, public.places_usage_counters, public.places_shared_limit, public.places_shared_counters, public.places_reservations TO service_role;

CREATE FUNCTION public.places_limits_stamp() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN NEW.updated_by := auth.uid(); NEW.updated_at := now(); RETURN NEW; END;
$$;
CREATE TRIGGER places_limits_stamp BEFORE INSERT OR UPDATE ON public.places_usage_limits FOR EACH ROW EXECUTE FUNCTION public.places_limits_stamp();
REVOKE ALL ON FUNCTION public.places_limits_stamp() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.places_reserve(p_org UUID, p_units INT, p_shared BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m DATE := date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date;
  lim INT; used_org INT; used_shared INT := 0; shared_lim INT; reservation UUID;
BEGIN
  IF p_org IS NULL OR p_units IS NULL OR p_units NOT BETWEEN 1 AND 3 OR p_shared IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  -- Shared row is inserted and locked BEFORE touching any organisation row.
  IF p_shared THEN
    SELECT monthly_limit INTO shared_lim FROM public.places_shared_limit WHERE singleton;
    IF shared_lim IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'error'); END IF;
    INSERT INTO public.places_shared_counters (month) VALUES (m) ON CONFLICT DO NOTHING;
    SELECT used INTO used_shared FROM public.places_shared_counters WHERE month = m FOR UPDATE;
  END IF;
  INSERT INTO public.places_usage_counters (org_id, month) VALUES (p_org, m) ON CONFLICT DO NOTHING;
  SELECT used INTO used_org FROM public.places_usage_counters WHERE org_id = p_org AND month = m FOR UPDATE;
  SELECT COALESCE((SELECT monthly_limit FROM public.places_usage_limits WHERE org_id = p_org), 900) INTO lim;
  IF used_org + p_units > lim THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org_limit', 'used', used_org, 'limit', lim, 'month', m);
  END IF;
  IF p_shared AND used_shared + p_units > shared_lim THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'shared_pool', 'used', used_shared, 'limit', shared_lim, 'month', m);
  END IF;
  IF p_shared THEN UPDATE public.places_shared_counters SET used = used + p_units WHERE month = m; END IF;
  UPDATE public.places_usage_counters SET used = used + p_units WHERE org_id = p_org AND month = m;
  INSERT INTO public.places_reservations (org_id, month, units, shared) VALUES (p_org, m, p_units, p_shared) RETURNING id INTO reservation;
  RETURN jsonb_build_object('ok', true, 'used', used_org + p_units, 'limit', lim, 'month', m, 'reservation_id', reservation);
END;
$$;

CREATE FUNCTION public.places_refund(p_org UUID, p_units INT, p_month DATE, p_reservation UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.places_reservations%ROWTYPE; n INT;
BEGIN
  IF p_month IS NULL OR p_month <> date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date
    OR p_units IS NULL OR p_units NOT BETWEEN 1 AND 3 THEN RETURN false; END IF;
  SELECT * INTO r FROM public.places_reservations WHERE id = p_reservation AND org_id = p_org AND month = p_month FOR UPDATE;
  IF NOT FOUND OR r.refunded OR p_units > r.units THEN RETURN false; END IF;
  IF r.shared THEN
    PERFORM 1 FROM public.places_shared_counters WHERE month = p_month FOR UPDATE;
  END IF;
  SELECT used INTO n FROM public.places_usage_counters WHERE org_id = p_org AND month = p_month FOR UPDATE;
  IF n IS NULL OR n < p_units THEN RETURN false; END IF;
  IF r.shared THEN
    UPDATE public.places_shared_counters SET used = used - p_units WHERE month = p_month AND used >= p_units;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  UPDATE public.places_usage_counters SET used = used - p_units WHERE org_id = p_org AND month = p_month;
  UPDATE public.places_reservations SET refunded = true WHERE id = r.id;
  RETURN true;
END;
$$;

-- Snapshot is the deliberate exception to service-only RPCs: members need their meter.
CREATE FUNCTION public.places_snapshot(p_org UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m DATE := date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
  IF p_org IS NULL OR NOT public.is_org_member(p_org) THEN
    RAISE EXCEPTION 'not a member of this organisation' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('month', m,
    'used', COALESCE((SELECT used FROM public.places_usage_counters WHERE org_id = p_org AND month = m), 0),
    'limit', COALESCE((SELECT monthly_limit FROM public.places_usage_limits WHERE org_id = p_org), 900),
    'resets_at', ((m + interval '1 month')::timestamp AT TIME ZONE 'America/Los_Angeles'));
END;
$$;
REVOKE ALL ON FUNCTION public.places_reserve(UUID, INT, BOOLEAN), public.places_refund(UUID, INT, DATE, UUID), public.places_snapshot(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.places_reserve(UUID, INT, BOOLEAN), public.places_refund(UUID, INT, DATE, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.places_snapshot(UUID) TO authenticated, service_role;
