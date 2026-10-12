-- 056: the other domains a company uses (for example a lead whose website is lovelivingmanagement.com while its
-- staff use loveliving.uk), found by domain discovery (Hunter company-name search, the lead's own website).
--
-- Security note (additive only, no RLS / grant / policy change):
-- * leads already has RLS enabled; the existing leads_view / leads_update / leads_delete policies (migration 023)
--   and leads_insert (018) cover this column exactly like every other leads column. No new policy is needed.
-- * authenticated holds table-level UPDATE on leads (no column narrowing), so a member who can already edit a lead
--   could also write this column through the REST API, exactly like `website`. That is acceptable: the app writes it
--   only from edge functions with the service client, and every edge-function reader re-validates each value
--   (cleanCompanyDomain + isPublicDomain + not free-mail / directory, see savedDomains in domainDiscoveryLookup.ts)
--   before using it. The browser only reads it.
-- * Domains found only by a web search are never stored here (they are marked needs_check in deep_find_leads.domains).
-- Additive and idempotent: safe to apply before the code that reads it is deployed.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_domains TEXT[] NOT NULL DEFAULT '{}';

-- Defensive bounds so a bad client write cannot store an unbounded list or huge values.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_email_domains_bounds;
ALTER TABLE leads ADD CONSTRAINT leads_email_domains_bounds
  CHECK (cardinality(email_domains) <= 8 AND length(array_to_string(email_domains, ',')) <= 2100);
