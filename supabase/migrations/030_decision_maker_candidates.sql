-- Tracks decision-maker candidates found via Hunter (free, already-revealed
-- name+email) and Apollo (free search, paid reveal) for the "Find decision
-- maker" Pipeline action. One row per (lead_id, source); re-running search
-- upserts rather than duplicating. All writes go through service-role edge
-- functions (search, reveal, or the Apollo phone webhook) — there is no
-- client INSERT/UPDATE policy, matching scrape_jobs/raw_leads.

CREATE TABLE decision_maker_candidates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('hunter', 'apollo')),
  apollo_person_id  TEXT,
  first_name        TEXT,
  last_name         TEXT,
  name_obfuscated   BOOLEAN NOT NULL DEFAULT false,
  title             TEXT,
  email             TEXT,
  email_revealed    BOOLEAN NOT NULL DEFAULT false,
  phone             TEXT,
  phone_status      TEXT NOT NULL DEFAULT 'not_requested'
                      CHECK (phone_status IN ('not_requested', 'pending', 'revealed', 'not_found', 'failed')),
  applied_at        TIMESTAMPTZ,
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, source)
);

ALTER TABLE decision_maker_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decision_maker_candidates_view" ON decision_maker_candidates
  FOR SELECT USING (can_view_lead(lead_id));

ALTER PUBLICATION supabase_realtime ADD TABLE decision_maker_candidates;
