-- Fixes I2 from the 2026-09-28 final review of decision-makers/LinkedIn
-- Phase 1 (.superpowers/sdd/2026-09-28-decision-makers-linkedin-phase1/final-review.md).
--
-- decision_maker_candidates' SELECT policy is `can_view_lead(lead_id)`, which
-- correctly respects the multi-pipeline per-lead/per-pipeline visibility
-- model (migrations 018-023): a contractor who isn't a member/owner/admin of
-- a lead's pipeline cannot see that lead's decision-maker candidates.
--
-- find-decision-makers' service-role auto-capture (migration 034) copies a
-- candidate's name and LinkedIn URL into linkedin_contacts the moment it's
-- found, so the same candidate is now ALSO reachable through
-- linkedin_contacts -- but that table's RLS was still the original
-- "linkedin_contacts_org_member" FOR ALL policy from migration 006
-- (is_org_member(org_id) only), predating both the multi-pipeline build and
-- this cycle's lead_id column. Any org member -- including a contractor who
-- cannot view the lead's pipeline -- could read, draft LinkedIn messages
-- for, approve, and mark-sent a decision-maker that belongs to a lead they
-- have no visibility into. This was latent as of 2026-09-28 (every live user
-- is an org admin) but becomes real the moment a contractor is onboarded --
-- the same failure shape as cycle 5's null-owner RLS gap (migration 009).
--
-- linkedin_drafts (its message text, template_variant, and status) has the
-- identical org-wide "linkedin_drafts_org_member" FOR ALL policy and is
-- reached the same way (joined off linkedin_contacts.contact_id) -- tightening
-- linkedin_contacts alone would just move the same leak one table over, so
-- both are fixed here together.
--
-- Fix: split each FOR ALL policy into per-command policies. SELECT/UPDATE/
-- DELETE require is_org_member(org_id) AND the linked lead (when any) is one
-- the caller can actually view. INSERT stays org-scoped only -- every client
-- insert (useLinkedinOutreach's addContact) always has lead_id null (a
-- manually-added contact), and find-decision-makers' auto-capture insert
-- runs via the service-role client, which bypasses RLS entirely regardless
-- of policy.
--
-- can_view_lead(UUID) looks up `leads` (joined through `pipelines`), not
-- linkedin_contacts/linkedin_drafts, so this is NOT the self-referential
-- same-statement pitfall fixed in migrations 022/023 -- an ordinary
-- cross-table lookup is visible immediately, including to a same-statement
-- INSERT ... RETURNING against a DIFFERENT table.

DROP POLICY "linkedin_contacts_org_member" ON linkedin_contacts;

CREATE POLICY "linkedin_contacts_insert" ON linkedin_contacts FOR INSERT
  WITH CHECK (is_org_member(org_id));

CREATE POLICY "linkedin_contacts_select" ON linkedin_contacts FOR SELECT
  USING (is_org_member(org_id) AND (lead_id IS NULL OR can_view_lead(lead_id)));

CREATE POLICY "linkedin_contacts_update" ON linkedin_contacts FOR UPDATE
  USING (is_org_member(org_id) AND (lead_id IS NULL OR can_view_lead(lead_id)))
  WITH CHECK (is_org_member(org_id) AND (lead_id IS NULL OR can_view_lead(lead_id)));

CREATE POLICY "linkedin_contacts_delete" ON linkedin_contacts FOR DELETE
  USING (is_org_member(org_id) AND (lead_id IS NULL OR can_view_lead(lead_id)));

DROP POLICY "linkedin_drafts_org_member" ON linkedin_drafts;

CREATE POLICY "linkedin_drafts_insert" ON linkedin_drafts FOR INSERT
  WITH CHECK (is_org_member(org_id));

CREATE POLICY "linkedin_drafts_select" ON linkedin_drafts FOR SELECT
  USING (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM linkedin_contacts c
      WHERE c.id = contact_id AND (c.lead_id IS NULL OR can_view_lead(c.lead_id))
    )
  );

CREATE POLICY "linkedin_drafts_update" ON linkedin_drafts FOR UPDATE
  USING (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM linkedin_contacts c
      WHERE c.id = contact_id AND (c.lead_id IS NULL OR can_view_lead(c.lead_id))
    )
  )
  WITH CHECK (is_org_member(org_id));

CREATE POLICY "linkedin_drafts_delete" ON linkedin_drafts FOR DELETE
  USING (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM linkedin_contacts c
      WHERE c.id = contact_id AND (c.lead_id IS NULL OR can_view_lead(c.lead_id))
    )
  );
