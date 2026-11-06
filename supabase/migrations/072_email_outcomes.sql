-- 072: email outcomes (bounce/reply/check learning). Reviewed by Claude 2026-11-06.
BEGIN;
CREATE TABLE public.email_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  address text NOT NULL CHECK (
    address = lower(btrim(address)) AND length(address) BETWEEN 3 AND 254
    AND address !~ '[[:cntrl:]]'
    AND address ~ '^[^[:space:]@<>,;:]+@[^[:space:]@<>,;:]+\.[a-z]{2,}$'
  ),
  domain text GENERATED ALWAYS AS (split_part(address, '@', 2)) STORED,
  outcome text NOT NULL CHECK (outcome IN (
    'bounced_hard','replied','checked_invalid','checked_valid','checked_unverifiable'
  )),
  source_message_id text NOT NULL CHECK (length(source_message_id) BETWEEN 1 AND 250),
  seen_at timestamptz NOT NULL,
  UNIQUE(org_id,address,outcome)
);
CREATE INDEX email_outcomes_domain_seen ON public.email_outcomes(org_id,domain,seen_at);
ALTER TABLE public.email_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_outcomes TO authenticated;
GRANT ALL ON public.email_outcomes TO service_role;
CREATE POLICY email_outcomes_org_read ON public.email_outcomes FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = email_outcomes.lead_id AND l.org_id = email_outcomes.org_id
  ));

CREATE FUNCTION public.record_email_outcome(
  p_org_id uuid, p_lead_id uuid, p_address text, p_outcome text,
  p_source_message_id text, p_seen_at timestamptz,
  p_pause_sequences boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  clean_address text := lower(btrim(p_address));
  note_text text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id AND org_id = p_org_id)
    OR p_seen_at IS NULL OR p_seen_at > now() + interval '5 minutes'
  THEN RAISE EXCEPTION 'Invalid email outcome scope or time'; END IF;

  -- The unique-row lock serialises repeated effects for the same address and outcome.
  INSERT INTO public.email_outcomes(org_id,lead_id,address,outcome,source_message_id,seen_at)
  VALUES(p_org_id,p_lead_id,clean_address,p_outcome,p_source_message_id,p_seen_at)
  ON CONFLICT (org_id,address,outcome) DO UPDATE SET
    seen_at = greatest(email_outcomes.seen_at,EXCLUDED.seen_at),
    lead_id = CASE WHEN EXCLUDED.seen_at > email_outcomes.seen_at
      THEN EXCLUDED.lead_id ELSE email_outcomes.lead_id END,
    source_message_id = CASE WHEN EXCLUDED.seen_at > email_outcomes.seen_at
      THEN EXCLUDED.source_message_id ELSE email_outcomes.source_message_id END;

  IF p_outcome = 'bounced_hard' THEN
    IF p_pause_sequences THEN
      UPDATE public.sequence_enrollments SET status = 'paused'
      WHERE lead_id = p_lead_id AND status = 'active';
    END IF;
    note_text := 'Email to ' || clean_address || ' bounced: address does not exist';
    INSERT INTO public.lead_notes(lead_id,created_by,note_type,content)
    SELECT p_lead_id,NULL,'general',note_text
    WHERE NOT EXISTS (SELECT 1 FROM public.lead_notes WHERE lead_id = p_lead_id AND content = note_text);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_email_outcome(uuid,uuid,text,text,text,timestamptz,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_outcome(uuid,uuid,text,text,text,timestamptz,boolean)
  TO service_role;

-- Expose only the derived warning, not another pipeline's private source addresses.
CREATE FUNCTION public.email_domain_bounce_warnings(p_org_id uuid,p_domains text[])
RETURNS TABLE(domain text) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF public.is_org_member(p_org_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_domains),0) > 40 OR EXISTS (
    SELECT 1 FROM unnest(p_domains) AS requested(value)
    WHERE value IS NULL OR length(value) NOT BETWEEN 1 AND 253 OR value !~ '^[a-z0-9.-]+$'
  ) THEN RAISE EXCEPTION 'Invalid domain request'; END IF;
  RETURN QUERY SELECT e.domain FROM public.email_outcomes e
    WHERE e.org_id = p_org_id AND e.domain = ANY(p_domains)
      AND e.outcome = 'bounced_hard' AND e.seen_at >= now() - interval '14 days' AND e.seen_at <= now()
    GROUP BY e.domain HAVING count(DISTINCT e.address) >= 3;
END;
$$;
REVOKE ALL ON FUNCTION public.email_domain_bounce_warnings(uuid,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_domain_bounce_warnings(uuid,text[]) TO authenticated;
COMMIT;
