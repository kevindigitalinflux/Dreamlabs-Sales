-- Allow several decision-maker candidates per lead per source.
--
-- Migration 030 enforced UNIQUE (lead_id, source): one Hunter and one Apollo
-- candidate per lead, so the search could only ever keep the single best match.
-- A business usually has more than one decision-maker (owner + director, etc.),
-- so uniqueness moves to the individual person instead: Hunter candidates are
-- identified by email, Apollo candidates by their Apollo person id.
--
-- dedupe_key is a plain generated column so PostgREST's upsert can target a
-- simple (lead_id, dedupe_key) unique constraint (it cannot infer an expression
-- or partial index; see migration 035 for the same lesson). It is never written
-- by clients: the search function's upsert payload simply omits it.

ALTER TABLE decision_maker_candidates
  DROP CONSTRAINT decision_maker_candidates_lead_id_source_key;

ALTER TABLE decision_maker_candidates
  ADD COLUMN dedupe_key TEXT GENERATED ALWAYS AS
    (source || ':' || coalesce(apollo_person_id, lower(email), id::text)) STORED;

ALTER TABLE decision_maker_candidates
  ADD CONSTRAINT decision_maker_candidates_lead_dedupe_key UNIQUE (lead_id, dedupe_key);
