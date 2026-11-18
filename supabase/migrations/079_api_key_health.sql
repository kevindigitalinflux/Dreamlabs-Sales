-- Draft only. Review and run the rolled-back audit before applying.
CREATE TABLE public.org_api_key_health (
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates','cro','lookup_worker','firecrawl','email_verifier')),
 state text NOT NULL CHECK(state IN ('refused','needs_topup','rate_limited')),
 status_code integer NOT NULL CHECK(status_code BETWEEN 100 AND 599),
 key_source text NOT NULL CHECK(key_source IN ('org','global')),
 feature text NOT NULL CHECK(length(feature) BETWEEN 1 AND 40 AND feature ~ '^[a-z_]+$'),
 first_failed_at timestamptz NOT NULL DEFAULT now(),last_failed_at timestamptz NOT NULL DEFAULT now(),
 failure_count integer NOT NULL DEFAULT 1 CHECK(failure_count>0), PRIMARY KEY(org_id,provider)
);
ALTER TABLE public.org_api_key_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_api_key_health FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.org_api_key_health TO authenticated;
GRANT ALL ON public.org_api_key_health TO service_role;
CREATE POLICY org_api_key_health_member_read ON public.org_api_key_health FOR SELECT TO authenticated USING(public.is_org_member(org_id));
ALTER PUBLICATION supabase_realtime ADD TABLE public.org_api_key_health;

CREATE OR REPLACE FUNCTION public.api_key_failure(p_org uuid,p_provider text,p_state text,p_code integer,p_source text,p_feature text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 INSERT INTO public.org_api_key_health AS h(org_id,provider,state,status_code,key_source,feature)
 VALUES(p_org,p_provider,p_state,p_code,p_source,p_feature)
 ON CONFLICT(org_id,provider) DO UPDATE SET
 state=CASE WHEN h.state IN ('refused','needs_topup') AND excluded.state='rate_limited' THEN h.state ELSE excluded.state END,
 status_code=CASE WHEN h.state IN ('refused','needs_topup') AND excluded.state='rate_limited' THEN h.status_code ELSE excluded.status_code END,
 key_source=CASE WHEN h.state IN ('refused','needs_topup') AND excluded.state='rate_limited' THEN h.key_source ELSE excluded.key_source END,
 feature=CASE WHEN h.state IN ('refused','needs_topup') AND excluded.state='rate_limited' THEN h.feature ELSE excluded.feature END,
 last_failed_at=now(),failure_count=h.failure_count+1
 WHERE h.last_failed_at<=now()-interval '60 seconds';
END $$;
CREATE OR REPLACE FUNCTION public.api_key_ok(p_org uuid,p_provider text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 DELETE FROM public.org_api_key_health WHERE org_id=p_org AND provider=p_provider;
END $$;
REVOKE ALL ON FUNCTION public.api_key_failure(uuid,text,text,integer,text,text),public.api_key_ok(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_failure(uuid,text,text,integer,text,text),public.api_key_ok(uuid,text) TO service_role;
