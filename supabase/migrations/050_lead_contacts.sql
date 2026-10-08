-- 050: lead contacts. decision_maker_candidates becomes the single per-lead contact list:
-- people AND general inboxes, typed by hand, by Dream Agent, or found by providers.
--
-- Until now every write went through service-role edge functions, plus one client UPDATE
-- (dismissed_at, migration 042). Members who can edit a lead may now add, edit and remove
-- their own contacts, but never touch the engine-owned or provider-owned columns
-- (lead_id, source, apollo_person_id, email_revealed, phone_status, created_by).
-- Service-role writers (search, reveal, Apollo phone webhook, registry-officer trigger)
-- bypass RLS and grants and are unaffected; the immutability trigger below only fires for
-- requests that carry an authenticated user (auth.uid() IS NOT NULL).

-- 1. Columns -------------------------------------------------------------------------
ALTER TABLE decision_maker_candidates
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'general')),
  ADD COLUMN label TEXT,
  ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN include_in_sequences BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE decision_maker_candidates DROP CONSTRAINT decision_maker_candidates_source_check;
ALTER TABLE decision_maker_candidates ADD CONSTRAINT decision_maker_candidates_source_check
  CHECK (source IN ('hunter', 'apollo', 'companies_house', 'cro', 'manual', 'dream_agent'));

-- 2. At most one live primary contact per lead (DB-enforced) ---------------------------
-- Dismissing a primary frees the slot; the app falls back deterministically (mainContact).
CREATE UNIQUE INDEX decision_maker_candidates_one_primary
  ON decision_maker_candidates (lead_id) WHERE is_primary AND dismissed_at IS NULL;

-- 3. Grants --------------------------------------------------------------------------
-- authenticated holds a blanket UPDATE grant until narrowed (see 042). Re-narrow to the
-- editable columns: 042's single dismissed_at grant is widened, nothing else.
REVOKE UPDATE ON decision_maker_candidates FROM authenticated;
GRANT UPDATE (first_name, last_name, title, email, phone, linkedin_url, kind, label,
              is_primary, include_in_sequences, dismissed_at, updated_at)
  ON decision_maker_candidates TO authenticated;
-- Explicit so this migration is self-contained; RLS policies below still govern.
GRANT INSERT, DELETE ON decision_maker_candidates TO authenticated;
-- Defence in depth: anon never writes (RLS already denies it).
REVOKE INSERT, UPDATE, DELETE ON decision_maker_candidates FROM anon;

-- 4. Policies ------------------------------------------------------------------------
-- SELECT stays exactly as migration 030 left it: "decision_maker_candidates_view",
-- USING (can_view_lead(lead_id)). Not touched here.

-- Same semantics as 042's dismiss policy, renamed since it now covers all editable columns.
DROP POLICY IF EXISTS "decision_maker_candidates_dismiss" ON decision_maker_candidates;
CREATE POLICY "decision_maker_candidates_update" ON decision_maker_candidates
  FOR UPDATE
  USING (can_edit_lead(lead_id))
  WITH CHECK (can_edit_lead(lead_id));

CREATE POLICY "decision_maker_candidates_insert" ON decision_maker_candidates
  FOR INSERT
  WITH CHECK (
    can_edit_lead(lead_id)
    AND source IN ('manual', 'dream_agent')
    AND created_by = auth.uid()
    AND apollo_person_id IS NULL
    AND email_revealed = false
    AND name_obfuscated = false
    AND phone_status = 'not_requested'
  );

-- Only hand-made rows are deletable; provider rows are dismissed instead (a delete would
-- let the next search put the person straight back, see 042).
CREATE POLICY "decision_maker_candidates_delete" ON decision_maker_candidates
  FOR DELETE
  USING (can_edit_lead(lead_id) AND source IN ('manual', 'dream_agent'));

-- 5. Immutability + updated_at -------------------------------------------------------
-- Column grants already exclude these columns; the trigger is the second lock (for
-- example if a later GRANT widens by mistake). SECURITY INVOKER: it only reads OLD/NEW
-- and auth.uid(). Service role / migrations have auth.uid() NULL and may change them.
CREATE OR REPLACE FUNCTION decision_maker_candidates_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.lead_id             IS DISTINCT FROM OLD.lead_id
       OR NEW.source           IS DISTINCT FROM OLD.source
       OR NEW.apollo_person_id IS DISTINCT FROM OLD.apollo_person_id
       OR NEW.email_revealed   IS DISTINCT FROM OLD.email_revealed
       OR NEW.phone_status     IS DISTINCT FROM OLD.phone_status
       OR NEW.created_by       IS DISTINCT FROM OLD.created_by
       OR NEW.name_obfuscated  IS DISTINCT FROM OLD.name_obfuscated
       OR NEW.id               IS DISTINCT FROM OLD.id
       OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'decision_maker_candidates: provider-owned columns cannot be changed'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS decision_maker_candidates_guard ON decision_maker_candidates;
CREATE TRIGGER decision_maker_candidates_guard BEFORE UPDATE ON decision_maker_candidates
  FOR EACH ROW EXECUTE FUNCTION decision_maker_candidates_guard();
