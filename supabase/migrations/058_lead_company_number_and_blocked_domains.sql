-- 058: Deep find v2. The lead's registered company number (Companies House), chosen automatically on a clear match
-- or by the user with "Use this company"; and the domains the user marked "Not their domain" (blocked_domains, below).
--
-- SECURITY NOTE (additive only; no RLS policy or grant change on any table):
-- * leads.company_number: nullable TEXT with a format CHECK (8 digits, or 2 letters + 6 digits). The existing leads
--   policies (migrations 018/023) cover it like every other leads column. authenticated already has table-level
--   UPDATE on leads, so a member who can edit a lead could also set this column through REST, like `website`; the
--   app writes it only from edge functions (run-deep-find choose_company after an org + can_edit_lead check and a
--   live Companies House lookup, or the engine on a clear match), and every reader re-validates the format
--   (cleanCompanyNumber) before using it in a Companies House URL.
-- Additive and idempotent: safe to apply before the code that reads it is deployed.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_number TEXT;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_company_number_format;
ALTER TABLE leads ADD CONSTRAINT leads_company_number_format
  CHECK (company_number IS NULL OR company_number ~ '^([0-9]{8}|[A-Z]{2}[0-9]{6})$');

-- Domains the user marked "Not their domain": removed from email_domains and never saved or searched again for this
-- lead. Same bounds pattern as email_domains (056).
-- SECURITY NOTE (continued):
-- * leads.blocked_domains: additive TEXT[] NOT NULL DEFAULT '{}', bounded by a CHECK; covered by the existing leads
--   policies like any other column (and writable through REST by someone who can already edit the lead, which only
--   makes discovery search less, never more). The app writes it only through lead_block_domain below.
-- * NEW FUNCTION public.lead_block_domain(lead, domain): SECURITY DEFINER, search_path = '', EXECUTE for service_role
--   only (run-deep-find's block_domain action calls it after its own org + can_edit_lead checks). Atomic: removes the
--   domain from email_domains and appends it to blocked_domains (dedupe, max 20, hostname shape checked).
-- * public.lead_add_email_domains (056) is REPLACED here so it also refuses blocked domains. Same signature, same
--   SECURITY DEFINER / search_path / service_role-only grants (re-issued below).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS blocked_domains TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_blocked_domains_bounds;
ALTER TABLE leads ADD CONSTRAINT leads_blocked_domains_bounds
  CHECK (cardinality(blocked_domains) <= 20 AND length(array_to_string(blocked_domains, ',')) <= 5200);

CREATE OR REPLACE FUNCTION public.lead_block_domain(target_lead UUID, bad_domain TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_blocked TEXT[];
BEGIN
  IF bad_domain IS NULL OR length(bad_domain) NOT BETWEEN 3 AND 253
     OR bad_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RETURN false;
  END IF;
  SELECT l.blocked_domains INTO current_blocked FROM public.leads l WHERE l.id = target_lead FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT (bad_domain = ANY (current_blocked)) AND cardinality(current_blocked) < 20 THEN
    current_blocked := array_append(current_blocked, bad_domain);
  END IF;
  UPDATE public.leads
     SET blocked_domains = current_blocked,
         email_domains = array_remove(email_domains, bad_domain)
   WHERE id = target_lead;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.lead_block_domain(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_block_domain(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.lead_add_email_domains(target_lead UUID, new_domains TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_domains TEXT[];
  current_blocked TEXT[];
  d TEXT;
BEGIN
  SELECT l.email_domains, l.blocked_domains INTO current_domains, current_blocked
    FROM public.leads l WHERE l.id = target_lead FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOREACH d IN ARRAY COALESCE(new_domains, ARRAY[]::TEXT[]) LOOP
    EXIT WHEN cardinality(current_domains) >= 8;
    IF d IS NOT NULL AND length(d) BETWEEN 3 AND 253
       AND d ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
       AND NOT (d = ANY (current_domains)) AND NOT (d = ANY (current_blocked)) THEN
      current_domains := array_append(current_domains, d);
    END IF;
  END LOOP;
  UPDATE public.leads SET email_domains = current_domains WHERE id = target_lead;
  RETURN current_domains;
END;
$$;
REVOKE ALL ON FUNCTION public.lead_add_email_domains(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_add_email_domains(UUID, TEXT[]) TO service_role;
