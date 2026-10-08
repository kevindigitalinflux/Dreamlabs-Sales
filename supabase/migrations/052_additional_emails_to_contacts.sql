-- 052: one-off copy of leads.additional_emails into general contacts.
--
-- MUST be applied only AFTER Pieces A2/A3/A4/A6 ship (contact model, contacts card,
-- composer recipients, per-contact sequences). Applying earlier would change who live
-- autopilot emails (pickRecipient ranks any candidate with an email above the lead's own
-- email) and the current UI renders these rows badly.
--
-- Rows get include_in_sequences = false (additional emails were manual-only recipients
-- before) and is_primary = false. Skips the lead's main email and any address already held
-- by ANY contact of that lead (any source, dismissed or not). dedupe_key (039) for a
-- manual row with an email is 'manual:<lowercased email>', so ON CONFLICT DO NOTHING
-- also covers a manual person sharing the address. Idempotent: a re-run adds nothing.
-- Runs as the migration role, so RLS does not apply; created_by is the lead's creator.
INSERT INTO decision_maker_candidates
  (lead_id, source, kind, label, email, is_primary, include_in_sequences, created_by)
SELECT DISTINCT ON (l.id, lower(btrim(e.addr)))
       l.id, 'manual', 'general', 'Additional email', lower(btrim(e.addr)), false, false, l.created_by
FROM leads l
CROSS JOIN LATERAL unnest(l.additional_emails) AS e(addr)
WHERE btrim(coalesce(e.addr, '')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  AND lower(btrim(e.addr)) IS DISTINCT FROM lower(btrim(coalesce(l.email, '')))
  AND NOT EXISTS (
    SELECT 1 FROM decision_maker_candidates c
    WHERE c.lead_id = l.id AND lower(btrim(c.email)) = lower(btrim(e.addr))
  )
ORDER BY l.id, lower(btrim(e.addr))
ON CONFLICT (lead_id, dedupe_key) DO NOTHING;
