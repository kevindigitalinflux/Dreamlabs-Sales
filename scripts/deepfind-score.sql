-- Read-only. Supply the pipeline UUID as :pipeline_id; run only after Kevin authorizes the audit.
WITH pipeline_leads AS (
  SELECT id, readiness, readiness_missing, phone, additional_phones
  FROM public.leads WHERE pipeline_id = :pipeline_id
), people AS (
  SELECT c.lead_id,
    bool_or(nullif(trim(c.title), '') IS NOT NULL) AS has_title,
    bool_or(nullif(trim(c.linkedin_url), '') IS NOT NULL) AS has_linkedin,
    bool_or(nullif(trim(c.phone), '') IS NOT NULL) AS has_phone
  FROM public.decision_maker_candidates c JOIN pipeline_leads l ON l.id = c.lead_id
  WHERE c.dismissed_at IS NULL GROUP BY c.lead_id
), facts AS (
  SELECT l.*, coalesce(p.has_title, false) AS has_title,
    coalesce(p.has_linkedin, false) AS has_linkedin,
    (nullif(trim(l.phone), '') IS NOT NULL OR coalesce(p.has_phone, false)
      OR EXISTS (SELECT 1 FROM unnest(l.additional_phones) value WHERE nullif(trim(value), '') IS NOT NULL)) AS has_phone
  FROM pipeline_leads l LEFT JOIN people p ON p.lead_id = l.id
), queue AS (
  SELECT q.* FROM public.deep_find_check_queue q JOIN pipeline_leads l ON l.id = q.lead_id
), verdicts AS (
  SELECT coalesce(verdict, status) AS name, count(*) AS total FROM queue GROUP BY coalesce(verdict, status)
), providers AS (
  SELECT coalesce(provider, 'unknown') AS name, count(*) AS total FROM queue GROUP BY coalesce(provider, 'unknown')
)
SELECT count(*) AS leads,
  count(*) FILTER (WHERE readiness = 'ready') AS leads_with_sendable_email,
  count(*) FILTER (WHERE has_title) AS leads_with_person_title,
  count(*) FILTER (WHERE has_linkedin) AS leads_with_person_linkedin,
  count(*) FILTER (WHERE coalesce(readiness = 'ready', false)::int + has_phone::int + has_linkedin::int >= 2) AS leads_with_two_channels,
  count(*) FILTER (WHERE 'company_match' = ANY(readiness_missing)) AS leads_flagged_company_match,
  (SELECT coalesce(jsonb_object_agg(name, total), '{}'::jsonb) FROM verdicts) AS queue_by_verdict,
  (SELECT coalesce(jsonb_object_agg(name, total), '{}'::jsonb) FROM providers) AS queue_by_provider
FROM facts;
