-- Decision-maker candidates: capture a LinkedIn URL when Hunter/Apollo
-- provide one (see Task 2). No other change to this table — it was already
-- the persistent per-lead record as of migration 030; this plan just stops
-- OTHER code from also copying its values onto leads.email/owner_name/phone
-- (Task 4), making it the sole source of truth.
ALTER TABLE decision_maker_candidates ADD COLUMN linkedin_url TEXT;

-- email_logs: which decision-maker (if any) a send went to, distinct from
-- the lead's own primary contact. Nullable -- every existing row and every
-- send that targets the lead's own email leaves this null.
ALTER TABLE email_logs ADD COLUMN decision_maker_candidate_id UUID REFERENCES decision_maker_candidates(id) ON DELETE SET NULL;

-- linkedin_contacts: bridge to leads/pipelines. Both nullable so every
-- existing manually-added contact (no lead tie today) keeps working
-- unchanged, surfaced under an "Unlinked" bucket in the UI (Task 11) rather
-- than breaking or disappearing.
ALTER TABLE linkedin_contacts ADD COLUMN lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE linkedin_contacts ADD COLUMN decision_maker_candidate_id UUID REFERENCES decision_maker_candidates(id) ON DELETE SET NULL;

-- Makes the auto-capture upsert in Task 3 idempotent: re-running "Find
-- decision maker" for a lead whose candidate already has a LinkedIn contact
-- updates that same row instead of creating a duplicate. Partial (WHERE ...
-- IS NOT NULL) so multiple manually-added contacts with no candidate link
-- are unaffected.
CREATE UNIQUE INDEX linkedin_contacts_candidate_unique ON linkedin_contacts (decision_maker_candidate_id) WHERE decision_maker_candidate_id IS NOT NULL;
