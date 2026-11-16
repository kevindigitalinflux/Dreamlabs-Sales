-- READ ONLY. Run only after Kevin authorizes the audit. Never starts a search or touches the queue.
-- Supply :run_ids as a PostgreSQL uuid[] value, e.g. ARRAY['<run UUID>','<run UUID>']::uuid[].
-- Contact/phone facts are current at scoring time. Readiness prefers each run's saved result JSON,
-- which the background queue refreshes, with the current lead as a legacy fallback.
-- Two channels retains the existing scorer's meaning: ready email, phone, person LinkedIn.
-- Provider counters are role-search INTERFACE ATTEMPTS (including refusals/errors), not billing counts.
WITH selected_runs AS (
 SELECT id,org_id FROM public.deep_find_runs WHERE id=ANY(:run_ids::uuid[])
), run_leads AS (
 SELECT d.run_id,d.org_id,d.lead_id,d.domains,
  coalesce(d.domains->>'readiness',l.readiness) AS readiness,
  coalesce(d.domains->'readiness_missing',to_jsonb(l.readiness_missing),'[]'::jsonb) AS missing,
  l.phone,l.additional_phones
 FROM public.deep_find_leads d JOIN selected_runs r ON r.id=d.run_id AND r.org_id=d.org_id
 JOIN public.leads l ON l.id=d.lead_id AND l.org_id=d.org_id
), people AS (
 SELECT l.run_id,c.lead_id,
  bool_or(c.kind='person' AND nullif(trim(c.first_name),'') IS NOT NULL AND nullif(trim(c.last_name),'') IS NOT NULL
   AND c.source IN ('role_search','team_page')) AS has_role_person,
  bool_or(c.kind='person' AND nullif(trim(c.first_name),'') IS NOT NULL AND nullif(trim(c.last_name),'') IS NOT NULL
   AND nullif(trim(c.title),'') IS NOT NULL) AS has_title,
  bool_or(c.kind='person' AND nullif(trim(c.linkedin_url),'') IS NOT NULL) AS has_linkedin,
  bool_or(nullif(trim(c.phone),'') IS NOT NULL) AS has_phone
 FROM run_leads l JOIN public.decision_maker_candidates c ON c.lead_id=l.lead_id
 WHERE c.dismissed_at IS NULL GROUP BY l.run_id,c.lead_id
), facts AS (
 SELECT l.*,coalesce(p.has_role_person,false) AS has_role_person,coalesce(p.has_title,false) AS has_title,
  coalesce(p.has_linkedin,false) AS has_linkedin,
  (nullif(trim(l.phone),'') IS NOT NULL OR coalesce(p.has_phone,false)
   OR EXISTS(SELECT 1 FROM unnest(l.additional_phones) value WHERE nullif(trim(value),'') IS NOT NULL)) AS has_phone
 FROM run_leads l LEFT JOIN people p ON p.run_id=l.run_id AND p.lead_id=l.lead_id
), queue AS (
 SELECT q.* FROM public.deep_find_check_queue q JOIN selected_runs r ON r.id=q.run_id AND r.org_id=q.org_id
), verdict_counts AS (
 SELECT run_id,coalesce(verdict,status) AS name,count(*) AS total FROM queue GROUP BY run_id,coalesce(verdict,status)
), reason_counts AS (
 SELECT run_id,coalesce(reason,'none') AS name,count(*) AS total FROM queue GROUP BY run_id,coalesce(reason,'none')
), provider_counts AS (
 SELECT run_id,coalesce(provider,'unknown') AS name,count(*) AS total FROM queue GROUP BY run_id,coalesce(provider,'unknown')
), scores AS (
 SELECT run_id,count(*) AS leads,count(*) FILTER(WHERE readiness='ready') AS ready,
  count(*) FILTER(WHERE has_role_person) AS leads_with_role_or_team_person,
  count(*) FILTER(WHERE has_title) AS leads_with_titled_person,
  count(*) FILTER(WHERE has_linkedin) AS leads_with_linkedin,
  count(*) FILTER(WHERE coalesce(readiness='ready',false)::int+has_phone::int+has_linkedin::int>=2) AS leads_with_two_channels,
  count(*) FILTER(WHERE missing ? 'company_match') AS leads_flagged_company_match,
  coalesce(sum(CASE WHEN domains->'role_searches_by_provider'->>'searxng' ~ '^[0-9]+$'
   THEN (domains->'role_searches_by_provider'->>'searxng')::bigint ELSE 0 END),0) AS searxng_search_attempts,
  coalesce(sum(CASE WHEN domains->'role_searches_by_provider'->>'gemini' ~ '^[0-9]+$'
   THEN (domains->'role_searches_by_provider'->>'gemini')::bigint ELSE 0 END),0) AS gemini_search_attempts
 FROM facts GROUP BY run_id
)
SELECT r.id AS run_id,coalesce(s.leads,0) AS leads,coalesce(s.ready,0) AS ready,
 coalesce(s.leads_with_role_or_team_person,0) AS leads_with_role_or_team_person,
 coalesce(s.leads_with_titled_person,0) AS leads_with_titled_person,
 coalesce(s.leads_with_linkedin,0) AS leads_with_linkedin,
 coalesce(s.leads_with_two_channels,0) AS leads_with_two_channels,
 coalesce(s.leads_flagged_company_match,0) AS leads_flagged_company_match,
 (SELECT coalesce(jsonb_object_agg(name,total),'{}'::jsonb) FROM verdict_counts q WHERE q.run_id=r.id) AS queue_by_verdict,
 (SELECT coalesce(jsonb_object_agg(name,total),'{}'::jsonb) FROM reason_counts q WHERE q.run_id=r.id) AS queue_by_reason,
 (SELECT coalesce(jsonb_object_agg(name,total),'{}'::jsonb) FROM provider_counts q WHERE q.run_id=r.id) AS queue_by_provider,
 jsonb_build_object('searxng',coalesce(s.searxng_search_attempts,0),'gemini',coalesce(s.gemini_search_attempts,0)) AS role_search_attempts_by_provider
FROM selected_runs r LEFT JOIN scores s ON s.run_id=r.id ORDER BY r.id;
