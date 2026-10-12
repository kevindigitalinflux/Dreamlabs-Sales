-- 056: the other domains a company uses (for example a lead whose website is lovelivingmanagement.com while its
-- staff use loveliving.uk), found by domain discovery (Hunter company-name search, the lead's own website).
--
-- Security note (additive only; no table RLS, policy or table grant changes):
-- * leads already has RLS enabled; the existing leads_view / leads_update / leads_delete policies (migration 023)
--   and leads_insert (018) cover this column exactly like every other leads column. No new policy is needed.
-- * authenticated holds table-level UPDATE on leads (no column narrowing), so a member who can already edit a lead
--   could also write this column through the REST API, exactly like `website`. That is acceptable: the app writes it
--   only from edge functions with the service client, and every edge-function reader re-validates each value
--   (cleanCompanyDomain + isPublicDomain + not free-mail / directory, see savedDomains in domainChecks.ts)
--   before using it. The browser only reads it.
-- * Domains found only by a web search are never stored here (they are marked needs_check in deep_find_leads.domains).
-- * NEW FUNCTION public.lead_add_email_domains (bottom of this file): SECURITY DEFINER, search_path = '', EXECUTE for
--   service_role only. Appends discovered domains atomically (dedupe, max 8) so concurrent lookups cannot drop each other's.
-- Additive and idempotent: safe to apply before the code that reads it is deployed.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_domains TEXT[] NOT NULL DEFAULT '{}';

-- Defensive bounds so a bad client write cannot store an unbounded list or huge values.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_email_domains_bounds;
ALTER TABLE leads ADD CONSTRAINT leads_email_domains_bounds
  CHECK (cardinality(email_domains) <= 8 AND length(array_to_string(email_domains, ',')) <= 2100);

-- Atomic append for discovery (no read-modify-write race between two lookups on one lead). Adds only new values,
-- keeps the existing order, never exceeds 8 values, and refuses anything that is not a plain lowercase hostname.
-- SECURITY DEFINER with an empty search_path; only the service role (edge functions) may call it.
CREATE OR REPLACE FUNCTION public.lead_add_email_domains(target_lead UUID, new_domains TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_domains TEXT[];
  d TEXT;
BEGIN
  SELECT l.email_domains INTO current_domains FROM public.leads l WHERE l.id = target_lead FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOREACH d IN ARRAY COALESCE(new_domains, ARRAY[]::TEXT[]) LOOP
    EXIT WHEN cardinality(current_domains) >= 8;
    IF d IS NOT NULL AND length(d) BETWEEN 3 AND 253
       AND d ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
       AND NOT (d = ANY (current_domains)) THEN
      current_domains := array_append(current_domains, d);
    END IF;
  END LOOP;
  UPDATE public.leads SET email_domains = current_domains WHERE id = target_lead;
  RETURN current_domains;
END;
$$;
REVOKE ALL ON FUNCTION public.lead_add_email_domains(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_add_email_domains(UUID, TEXT[]) TO service_role;
